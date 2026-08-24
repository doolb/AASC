import { Type } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { parseSearchResults, readOnlyFetch } from './pi-readonly-tools.js';
import { normalizePiApiKey } from './pi-runtime-policy.js';

const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';

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
        pi.registerProvider('aasc-openai', {
            baseUrl,
            apiKey: normalizePiApiKey(process.env.AASC_PI_API_KEY),
            api: 'openai-completions',
            models: [{
                id: modelId,
                name: modelId,
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192
            }]
        });
    }
    pi.registerTool(webFetchTool);
    pi.registerTool(webSearchTool);
}
