'use strict';

const crypto = require('node:crypto');

function createGatewayError(message, code, statusCode = 500, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    Object.assign(error, details);
    return error;
}

function normalizeModelId(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeChunkText(data) {
    const candidates = [
        data?.text,
        data?.delta,
        data?.chunk?.text,
        data?.chunk,
        data?.output_text
    ];
    return candidates.find((value) => typeof value === 'string') || '';
}

function getHeader(headers, name) {
    const expected = name.toLowerCase();
    const entry = Object.entries(headers || {})
        .find(([key]) => key.toLowerCase() === expected);
    return entry ? entry[1] : null;
}

const LLM_IMAGE_MAX_DATA_URL_LENGTH = 8 * 1024 * 1024;
const LLM_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const LLM_IMAGE_MAX_COUNT = 4;
const LLM_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function createImageGatewayError(message, code = 'LLM_IMAGE_INVALID') {
    return createGatewayError(message, code, 400);
}

function normalizeLlmImageUrl(value) {
    const dataUrl = typeof value === 'string' ? value.trim() : '';
    if (!dataUrl.toLowerCase().startsWith('data:')) {
        throw createImageGatewayError('本地 LLM 图片只支持 data URL', 'LLM_IMAGE_UNSUPPORTED');
    }
    if (dataUrl.length > LLM_IMAGE_MAX_DATA_URL_LENGTH) {
        throw createImageGatewayError('LLM 图片数据超过大小限制');
    }
    const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/iu.exec(dataUrl);
    if (!match || !LLM_IMAGE_MIME_TYPES.has(match[1].toLowerCase())) {
        throw createImageGatewayError('LLM 图片必须是 JPEG、PNG 或 WebP 的 Base64 data URL');
    }
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length === 0 || bytes.length > LLM_IMAGE_MAX_BYTES) {
        throw createImageGatewayError('LLM 图片数据无效或超过大小限制');
    }
    return dataUrl;
}

function normalizeImageUrlField(value) {
    if (typeof value === 'string') return normalizeLlmImageUrl(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return normalizeLlmImageUrl(value.url);
    }
    throw createImageGatewayError('LLM 图片缺少 image_url');
}

function normalizeLlmContent(content, protocol, imageState) {
    if (content === undefined || content === null) return '';
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) {
        throw createGatewayError('LLM 消息 content 必须是字符串或内容数组', 'LLM_CONTENT_INVALID', 400);
    }
    return content.map((part) => {
        if (typeof part === 'string') return { type: 'text', text: part };
        if (!part || typeof part !== 'object' || Array.isArray(part)) {
            throw createGatewayError('LLM 消息内容片段无效', 'LLM_CONTENT_INVALID', 400);
        }
        const type = typeof part.type === 'string' ? part.type : '';
        if (type === 'text' || type === 'input_text' || type === 'output_text') {
            if (typeof part.text !== 'string') {
                throw createGatewayError('LLM 文本内容缺少 text', 'LLM_CONTENT_INVALID', 400);
            }
            return { ...part, text: part.text };
        }
        const isChatImage = type === 'image_url' && protocol === 'chat.completions';
        const isResponsesImage = type === 'input_image' && protocol === 'responses';
        if (isChatImage || isResponsesImage) {
            imageState.count += 1;
            if (imageState.count > LLM_IMAGE_MAX_COUNT) {
                throw createImageGatewayError(`单个 LLM 请求最多支持 ${LLM_IMAGE_MAX_COUNT} 张图片`);
            }
            if (isChatImage) {
                return { type, image_url: { url: normalizeImageUrlField(part.image_url) } };
            }
            return { type, image_url: normalizeImageUrlField(part.image_url) };
        }
        throw createGatewayError(`不支持的 LLM 内容类型: ${type || 'unknown'}`, 'LLM_CONTENT_UNSUPPORTED', 400);
    });
}

function normalizeChatMessages(messages, imageState) {
    return messages.map((message) => {
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            throw createGatewayError('chat.completions 的 message 无效', 'LLM_MESSAGES_INVALID', 400);
        }
        return {
            ...message,
            content: normalizeLlmContent(message.content, 'chat.completions', imageState)
        };
    });
}

function normalizeResponsesInput(input, imageState) {
    if (typeof input === 'string') return input;
    if (!Array.isArray(input)) {
        if (input && typeof input === 'object' && !Array.isArray(input)) {
            return [{
                ...input,
                content: normalizeLlmContent(input.content, 'responses', imageState)
            }];
        }
        throw createGatewayError('responses 的 input 无效', 'LLM_INPUT_INVALID', 400);
    }
    return input.map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw createGatewayError('responses 的 input item 无效', 'LLM_INPUT_INVALID', 400);
        }
        const type = typeof item.type === 'string' ? item.type : '';
        if (type === 'input_text' || type === 'input_image') {
            return normalizeLlmContent([item], 'responses', imageState)[0];
        }
        if (type === 'message' || item.role) {
            return {
                ...item,
                content: normalizeLlmContent(item.content, 'responses', imageState)
            };
        }
        throw createGatewayError(`不支持的 Responses input 类型: ${type || 'unknown'}`, 'LLM_INPUT_UNSUPPORTED', 400);
    });
}

function normalizePayload(protocol, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw createGatewayError('请求体必须是 JSON 对象', 'LLM_INVALID_REQUEST', 400);
    }
    const modelId = normalizeModelId(body.model);
    if (!modelId) {
        throw createGatewayError('缺少模型名', 'LLM_MODEL_REQUIRED', 400);
    }
    if (protocol === 'chat.completions'
        && (!Array.isArray(body.messages) || body.messages.length === 0)) {
        throw createGatewayError('chat.completions 需要 messages', 'LLM_MESSAGES_REQUIRED', 400);
    }
    if (protocol === 'responses'
        && (body.input === undefined || body.input === null || body.input === '')) {
        throw createGatewayError('responses 需要 input', 'LLM_INPUT_REQUIRED', 400);
    }
    const imageState = { count: 0 };
    const payload = { ...body };
    if (protocol === 'chat.completions') {
        payload.messages = normalizeChatMessages(body.messages, imageState);
    } else {
        payload.input = normalizeResponsesInput(body.input, imageState);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'enable_thinking')
        && typeof body.enable_thinking !== 'boolean') {
        throw createGatewayError('enable_thinking 必须是布尔值', 'LLM_THINKING_INVALID', 400);
    }
    return {
        modelId,
        stream: body.stream === true,
        payload: { ...payload, model: modelId }
    };
}

class LlmGatewayService {
    constructor({
        modelManifestService,
        router,
        sendToDisplay,
        logger = () => {},
        requestTimeoutMs = 120000
    }) {
        this.modelManifestService = modelManifestService;
        this.router = router;
        this.sendToDisplay = sendToDisplay;
        this.logger = logger;
        this.requestTimeoutMs = requestTimeoutMs;
        this.pending = new Map();
        this.sequence = 0;
    }

    generateRequestId() {
        this.sequence += 1;
        return `llm-${Date.now()}-${this.sequence.toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
    }

    clearRequestTimeout(pending) {
        if (!pending?.timer) return;
        clearTimeout(pending.timer);
        pending.timer = null;
    }

    scheduleRequestTimeout(pending) {
        this.clearRequestTimeout(pending);
        pending.timer = setTimeout(() => {
            const timeoutError = createGatewayError('本地 LLM 请求超时', 'LLM_REQUEST_TIMEOUT', 504, {
                requestId: pending.requestId,
                displayId: pending.targetDisplayId
            });
            // 超时必须复用 cancel()，让 APK 收到 llm.cancel，不能只清理服务端 pending。
            this.cancel(pending.requestId, timeoutError);
        }, this.requestTimeoutMs);
    }

    hasModel(modelId) {
        const resolvedModelId = this.modelManifestService.resolveModelId(modelId);
        const manifest = this.modelManifestService.createManifest({ includeIncomplete: true });
        return manifest.models.some((model) => model.modelId === resolvedModelId && model.ready === true);
    }

    validateRequest(protocol, body, headers = {}) {
        const normalized = normalizePayload(protocol, body);
        const modelId = this.modelManifestService.resolveModelId(normalized.modelId);
        if (!modelId || !this.hasModel(modelId)) {
            throw createGatewayError(
                `未知 LLM 模型: ${normalized.modelId}`,
                'LLM_MODEL_UNKNOWN',
                400
            );
        }
        return {
            requestId: this.generateRequestId(),
            protocol,
            requestedModelId: normalized.modelId,
            modelId,
            stream: normalized.stream,
            payload: { ...normalized.payload, model: modelId },
            displayId: normalizeModelId(getHeader(headers, 'X-AASC-Display-Id'))
        };
    }

    startRequest(request, onChunk = () => {}) {
        const route = this.router.acquire(request.requestId, {
            modelId: request.modelId,
            displayId: request.displayId
        });
        let settled = false;
        const pending = {
            ...request,
            targetDisplayId: route.displayId,
            onChunk,
            text: '',
            timer: null,
            resolve: null,
            reject: null
        };
        const promise = new Promise((resolve, reject) => {
            pending.resolve = resolve;
            pending.reject = reject;
        });
        const cleanup = () => {
            this.clearRequestTimeout(pending);
            this.pending.delete(request.requestId);
            this.router.release(request.requestId);
        };
        const fail = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            pending.reject(error);
        };
        pending.finish = (data = {}) => {
            if (settled) return;
            settled = true;
            cleanup();
            const completedText = typeof data.text === 'string' ? data.text : pending.text;
            pending.resolve({ ...data, text: completedText });
        };
        this.pending.set(request.requestId, pending);
        this.scheduleRequestTimeout(pending);

        try {
            this.router.markActive(request.requestId);
            const sent = this.sendToDisplay(route.displayId, {
                type: 'llm.request',
                requestId: request.requestId,
                protocol: request.protocol,
                modelId: request.modelId,
                payload: request.payload,
                stream: request.stream
            });
            if (!sent) {
                throw createGatewayError('目标显示端已断开', 'LLM_TARGET_UNAVAILABLE', 503, {
                    requestId: request.requestId,
                    displayId: route.displayId
                });
            }
        } catch (error) {
            fail(error);
            throw error;
        }
        this.logger('dispatched', {
            requestId: request.requestId,
            modelId: request.modelId,
            displayId: route.displayId,
            protocol: request.protocol
        });
        return {
            requestId: request.requestId,
            displayId: route.displayId,
            promise
        };
    }

    handleDisplayMessage(displayId, data) {
        if (data?.type === 'llm.status') {
            const status = data.status && typeof data.status === 'object' && !Array.isArray(data.status)
                ? data.status
                : data;
            this.router.updateDisplayStatus(displayId, status);
            return true;
        }
        if (!['llm.chunk', 'llm.completed', 'llm.error'].includes(data?.type)) {
            return false;
        }
        const pending = this.pending.get(data.requestId);
        if (!pending || pending.targetDisplayId !== displayId) return true;
        if (data.type === 'llm.chunk') {
            // chunk 表示目标端仍在推进推理；长回答只要持续有输出就不触发空闲超时。
            this.scheduleRequestTimeout(pending);
            const text = normalizeChunkText(data);
            if (!text) return true;
            pending.text += text;
            try {
                pending.onChunk(text, data);
            } catch (error) {
                this.cancel(data.requestId, error);
            }
            return true;
        }
        if (data.type === 'llm.error') {
            const error = createGatewayError(
                data.error || '显示端 LLM 推理失败',
                data.code || 'LLM_INFERENCE_FAILED',
                Number.isInteger(data.statusCode) ? data.statusCode : 502,
                { requestId: data.requestId, displayId }
            );
            pending.reject(error);
            this.pending.delete(data.requestId);
            this.clearRequestTimeout(pending);
            this.router.release(data.requestId);
            return true;
        }
        pending.finish(data);
        return true;
    }

    cancel(requestId, reason = new Error('请求已取消')) {
        const pending = this.pending.get(requestId);
        if (!pending) return false;
        this.sendToDisplay(pending.targetDisplayId, {
            type: 'llm.cancel',
            requestId
        });
        pending.reject(reason);
        this.clearRequestTimeout(pending);
        this.pending.delete(requestId);
        this.router.release(requestId);
        return true;
    }

    handleDisplayDisconnect(displayId) {
        const requestIds = this.router.unregisterDisplay(displayId);
        for (const requestId of requestIds) {
            const pending = this.pending.get(requestId);
            if (!pending) continue;
            pending.reject(createGatewayError('显示端已断开', 'LLM_TARGET_UNAVAILABLE', 503, {
                requestId,
                displayId
            }));
            this.clearRequestTimeout(pending);
            this.pending.delete(requestId);
            this.router.release(requestId);
        }
    }

    getStatus() {
        return {
            status: 'running',
            modelCount: this.modelManifestService.createManifest({ includeIncomplete: true }).models.length,
            displayCount: this.router.listDisplayStatuses().filter((display) => display.connected).length,
            pendingCount: this.pending.size
        };
    }

    createModelsResponse() {
        const manifest = this.modelManifestService.createManifest({ includeIncomplete: true });
        const statuses = this.router.listDisplayStatuses();
        return {
            object: 'list',
            data: manifest.models.map((model) => {
                const displayIds = statuses
                    .filter((display) => display.supported && display.selectedModelId === model.modelId)
                    .map((display) => display.displayId);
                const readyDisplayIds = statuses
                    .filter((display) => display.ready && display.selectedModelId === model.modelId)
                    .map((display) => display.displayId);
                return {
                    id: model.modelId,
                    object: 'model',
                    created: Math.floor(Date.now() / 1000),
                    owned_by: 'aasc',
                    metadata: {
                        displayName: model.displayName,
                        engine: model.engine,
                        architecture: model.architecture,
                        revision: model.revision,
                        aliases: model.aliases || [],
                        displayIds,
                        readyDisplayIds,
                        selectedDisplayIds: displayIds
                    }
                };
            })
        };
    }

    createChatResponse(request, result) {
        return {
            id: request.requestId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: request.requestedModelId || request.modelId,
            choices: [{
                index: 0,
                message: { role: 'assistant', content: result.text || '' },
                finish_reason: 'stop'
            }]
        };
    }

    createResponsesResponse(request, result) {
        return {
            id: request.requestId,
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            model: request.requestedModelId || request.modelId,
            status: 'completed',
            output_text: result.text || '',
            output: [{
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: result.text || '', annotations: [] }]
            }]
        };
    }
}

function createOpenAiErrorBody(error, requestId = null) {
    return {
        error: {
            message: error.message,
            type: 'aasc_llm_error',
            code: error.code || 'LLM_ERROR',
            param: null,
            requestId: error.requestId || requestId || null,
            displayId: error.displayId || null
        }
    };
}

module.exports = {
    LlmGatewayService,
    createGatewayError,
    createOpenAiErrorBody,
    normalizeChunkText,
    normalizePayload
};
