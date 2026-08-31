import {
    Type,
    createAssistantMessageEventStream,
    createProvider
} from '@earendil-works/pi-ai';
import { stat as fsStat } from 'node:fs/promises';
import nodePath from 'node:path';
import { openAIResponsesApi } from '@earendil-works/pi-ai/compat';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { parseSearchResults, readOnlyFetch } from './pi-readonly-tools.js';
import chat2ApiToolConverter from './pi-chat2api-tool-converter.js';
import { FIND_DEFAULT_LIMIT, findFiles } from './pi-find-tool.mjs';
import { normalizePiApiKey } from './pi-runtime-policy.js';

const {
    DEFAULT_CHAT2API_TOOLS,
    convertChat2ApiContent
} = chat2ApiToolConverter;

const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';

// Chat2API 可能把工具调用放在助手文本中；Pi 的 RPC 工具循环只识别
// `toolCall` 内容块，所以这里统一从 Provider 边界转换，避免标签进入 TTS。
function getAssistantText(message) {
    return message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
}

function getDoneReason(stopReason) {
    return ['stop', 'length', 'toolUse', 'deferred'].includes(stopReason) ? stopReason : 'stop';
}

function emitAssistantMessage(stream, message) {
    const partial = { ...message, content: [] };
    stream.push({ type: 'start', partial });
    for (const block of message.content) {
        const contentIndex = partial.content.length;
        partial.content.push(block);
        if (block.type === 'text') {
            stream.push({ type: 'text_start', contentIndex, partial });
            stream.push({ type: 'text_delta', contentIndex, delta: block.text, partial });
            stream.push({ type: 'text_end', contentIndex, content: block.text, partial });
            continue;
        }
        if (block.type === 'thinking') {
            stream.push({ type: 'thinking_start', contentIndex, partial });
            stream.push({ type: 'thinking_delta', contentIndex, delta: block.thinking, partial });
            stream.push({ type: 'thinking_end', contentIndex, content: block.thinking, partial });
            continue;
        }
        if (block.type === 'toolCall') {
            stream.push({ type: 'toolcall_start', contentIndex, partial });
            stream.push({
                type: 'toolcall_delta',
                contentIndex,
                delta: JSON.stringify(block.arguments),
                partial
            });
            stream.push({ type: 'toolcall_end', contentIndex, toolCall: block, partial });
        }
    }
    stream.push({ type: 'done', reason: getDoneReason(message.stopReason), message: partial });
    stream.end();
}

function emitProviderError(stream, model, error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const output = {
        role: 'assistant',
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'error',
        errorMessage,
        timestamp: Date.now()
    };
    stream.push({ type: 'error', reason: 'error', error: output });
    stream.end();
}

function createChat2ApiCompatibleStream(source, model, context) {
    const stream = createAssistantMessageEventStream();
    (async () => {
        try {
            const message = await source.result();
            if (message.stopReason === 'error' || message.stopReason === 'aborted') {
                emitProviderError(stream, model, new Error(message.errorMessage || 'Pi Provider 请求失败'));
                return;
            }

            const text = getAssistantText(message);
            const allowedTools = context.tools || DEFAULT_CHAT2API_TOOLS;
            const converted = convertChat2ApiContent(text, allowedTools);
            if (converted.calls.length === 0) {
                emitAssistantMessage(stream, message);
                return;
            }

            const nonTextBlocks = message.content.filter((block) => block.type !== 'text');
            const convertedContent = [];
            if (converted.text) convertedContent.push({ type: 'text', text: converted.text });
            convertedContent.push(...nonTextBlocks, ...converted.calls);
            emitAssistantMessage(stream, {
                ...message,
                content: convertedContent,
                stopReason: 'toolUse'
            });
        } catch (error) {
            emitProviderError(stream, model, error);
        }
    })();
    return stream;
}

// 使用 Pi AI 原生 OpenAI Responses 适配器完成网络请求，仅替换最终消息
// 的协议表示。这样文件和网络工具仍由 Pi 根据 --tools 白名单执行。
function createChat2ApiCompatibleProvider({ baseUrl, modelId }) {
    const openAiApi = openAIResponsesApi();
    const model = {
        id: modelId,
        name: modelId,
        api: 'openai-responses',
        provider: 'aasc-openai',
        baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192
    };
    return createProvider({
        id: 'aasc-openai',
        name: 'AASC Chat2API',
        baseUrl,
        auth: {
            apiKey: {
                name: 'AASC Pi API key',
                resolve: async () => ({
                    auth: { apiKey: normalizePiApiKey(process.env.AASC_PI_API_KEY) },
                    source: 'AASC_PI_API_KEY'
                })
            }
        },
        models: [model],
        api: {
            stream: (requestModel, context, options) => createChat2ApiCompatibleStream(
                openAiApi.stream(requestModel, context, options),
                requestModel,
                context
            ),
            streamSimple: (requestModel, context, options) => createChat2ApiCompatibleStream(
                openAiApi.streamSimple(requestModel, context, options),
                requestModel,
                context
            )
        }
    });
}

const webFetchTool = defineTool({
    name: 'aasc_web_fetch',
    label: 'AASC Web Fetch',
    description: '读取一个公开 HTTP/HTTPS 网页，只允许 GET 且限制响应大小。',
    parameters: Type.Object({
        url: Type.String({ description: '需要读取的 HTTP/HTTPS URL' })
    }),
    async execute(_toolCallId, params) {
        const result = await readOnlyFetch(params.url);
        return {
            content: [{ type: 'text', text: result.text }],
            details: { status: result.status, contentType: result.contentType }
        };
    }
});

const findTool = defineTool({
    name: 'aasc_find',
    label: 'AASC Find',
    description: '按 glob 模式查找项目内文件，只读且跳过 .git、node_modules，不依赖外部 fd。',
    parameters: Type.Object({
        pattern: Type.String({ description: "文件 glob 模式，例如 '*.json' 或 '**/*.spec.js'" }),
        path: Type.Optional(Type.String({ description: '查找目录，默认当前项目目录' })),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: FIND_DEFAULT_LIMIT }))
    }),
    async execute(_toolCallId, { pattern, path: searchDir, limit }, signal) {
        const searchPath = nodePath.resolve(process.cwd(), searchDir || '.');
        let stats;
        try {
            stats = await fsStat(searchPath);
        } catch (error) {
            throw new Error(`Path not found: ${searchPath}`);
        }
        if (!stats.isDirectory()) throw new Error(`Not a directory: ${searchPath}`);
        const effectiveLimit = Math.min(
            FIND_DEFAULT_LIMIT,
            Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : FIND_DEFAULT_LIMIT)
        );
        const results = await findFiles(searchPath, pattern, effectiveLimit, signal);
        return {
            content: [{
                type: 'text',
                text: results.length > 0 ? results.join('\n') : 'No files found matching pattern'
            }],
            details: results.length >= effectiveLimit ? { resultLimitReached: effectiveLimit } : undefined
        };
    }
});

const webSearchTool = defineTool({
    name: 'aasc_web_search',
    label: 'AASC Web Search',
    description: '通过服务器固定搜索入口查询公开网页。',
    parameters: Type.Object({
        query: Type.String({ description: '搜索关键词' }),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10 }))
    }),
    async execute(_toolCallId, params) {
        const query = String(params.query || '').trim();
        if (!query || query.length > 200) {
            throw new Error('搜索关键词不能为空且长度不能超过 200');
        }
        const url = new URL(SEARCH_ENDPOINT);
        url.searchParams.set('q', query);
        const result = await readOnlyFetch(url.toString());
        const items = parseSearchResults(result.text, params.limit || 5);
        return {
            content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
            details: { status: result.status, count: items.length }
        };
    }
});

export default function registerAascReadonlyTools(pi) {
    const baseUrl = process.env.AASC_PI_BASE_URL;
    const modelId = process.env.AASC_PI_MODEL || 'aasc-model';
    if (baseUrl) {
        pi.registerProvider(createChat2ApiCompatibleProvider({ baseUrl, modelId }));
    }
    pi.registerTool(findTool);
    pi.registerTool(webFetchTool);
    pi.registerTool(webSearchTool);
}
