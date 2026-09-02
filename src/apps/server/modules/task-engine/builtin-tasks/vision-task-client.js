'use strict';

const http = require('node:http');
const https = require('node:https');

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8081';
const DEFAULT_TIMEOUT_MS = 120000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const IMAGE_FILE_PATTERN = /\.(?:jpe?g|png|webp|bmp|gif)$/i;
const OCR_SHORT_SIDE_MIN = 256;
const OCR_SHORT_SIDE_MAX = 2048;

/**
 * 规范化任务配置中的服务器地址，避免重复拼接斜杠或误把其他协议交给 HTTP 客户端。
 */
function normalizeServerUrl(value = DEFAULT_SERVER_URL) {
    const text = String(value || DEFAULT_SERVER_URL).trim();
    let parsed;
    try {
        parsed = new URL(text);
    } catch (error) {
        throw new Error(`视觉服务器 URL 无效: ${text}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('视觉服务器 URL 只支持 http 或 https');
    }

    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
}

function normalizeImageBuffer(image) {
    if (Buffer.isBuffer(image)) return image;
    if (image instanceof Uint8Array) return Buffer.from(image);
    if (typeof image === 'string') {
        const base64 = image.replace(/^data:[^;]+;base64,/, '');
        return Buffer.from(base64, 'base64');
    }
    throw new Error('视觉任务图片必须是 Buffer、Uint8Array 或 Base64 字符串');
}

/** 统一校验 OCR 短边参数，任务调用方和 HTTP 请求体使用同一范围。 */
function normalizeVisionShortSide(value) {
    if (value === undefined || value === null || String(value).trim() === '') return 0;
    const number = Number(value);
    if (!Number.isInteger(number) || (number !== 0 && (number < OCR_SHORT_SIDE_MIN || number > OCR_SHORT_SIDE_MAX))) {
        throw new Error(`OCR 短边必须为 0 或 ${OCR_SHORT_SIDE_MIN}..${OCR_SHORT_SIDE_MAX} 的整数`);
    }
    return number;
}

function resolveImageFile(files, imageFileName) {
    if (!files || typeof files !== 'object') return null;
    if (imageFileName && files[imageFileName]) {
        return { name: imageFileName, data: normalizeImageBuffer(files[imageFileName]) };
    }

    const imageEntry = Object.entries(files).find(([name]) => IMAGE_FILE_PATTERN.test(name));
    if (!imageEntry) return null;
    return { name: imageEntry[0], data: normalizeImageBuffer(imageEntry[1]) };
}

function isLoopbackUrl(url) {
    return LOOPBACK_HOSTS.has(url.hostname);
}

function createVisionRequestError(message, code, statusCode) {
    const error = new Error(message);
    if (code) error.code = code;
    if (statusCode) error.statusCode = statusCode;
    return error;
}

function requestJsonOnce(requestUrl, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        const requestModule = requestUrl.protocol === 'https:' ? https : http;
        const requestOptions = {
            protocol: requestUrl.protocol,
            hostname: requestUrl.hostname,
            port: requestUrl.port || undefined,
            path: `${requestUrl.pathname}${requestUrl.search}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        if (requestUrl.protocol === 'https:' && isLoopbackUrl(requestUrl)) {
            // 本机开发服务器通常使用自签名证书；远程服务器仍保持系统证书校验。
            requestOptions.rejectUnauthorized = false;
        }

        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            callback(value);
        };

        let request;
        try {
            request = requestModule.request(requestOptions, (response) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('error', (error) => finish(reject, error));
                response.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let payload = {};
                    try {
                        payload = text ? JSON.parse(text) : {};
                    } catch (error) {
                        finish(reject, createVisionRequestError(
                            `视觉接口返回无效 JSON (HTTP ${response.statusCode})`,
                            'VISION_INVALID_RESPONSE',
                            response.statusCode
                        ));
                        return;
                    }

                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        const message = payload.message || payload.error || `视觉接口请求失败 (HTTP ${response.statusCode})`;
                        const requestError = createVisionRequestError(message, 'VISION_HTTP_ERROR', response.statusCode);
                        requestError.response = payload;
                        finish(reject, requestError);
                        return;
                    }
                    finish(resolve, payload);
                });
            });
            request.setTimeout(timeoutMs, () => {
                const timeoutError = createVisionRequestError('视觉接口请求超时', 'VISION_TIMEOUT');
                request.destroy(timeoutError);
            });
            request.once('error', (error) => finish(reject, error));
            request.end(body);
        } catch (error) {
            finish(reject, error);
        }
    });
}

function appendVisionPath(serverUrl, endpointPath) {
    const base = new URL(normalizeServerUrl(serverUrl));
    const relativePath = String(endpointPath || '').startsWith('/')
        ? String(endpointPath).slice(1)
        : String(endpointPath);
    const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
    return new URL(relativePath, `${base.origin}${basePath}`);
}

/**
 * 调用服务器视觉路由。服务器只做 HTTP/WebSocket 转发，真正的 OCR/YOLO 推理在显示端完成。
 * 本机默认先尝试 HTTP，兼容当前带自签名证书的 HTTPS 开发服务器。
 */
async function requestVisionJson({
    serverUrl = DEFAULT_SERVER_URL,
    path: endpointPath,
    image,
    displayId = null,
    shortSide,
    timeoutMs = DEFAULT_TIMEOUT_MS
}) {
    const imageBuffer = normalizeImageBuffer(image);
    if (imageBuffer.length === 0) throw new Error('视觉任务图片不能为空');
    if (!endpointPath) throw new Error('视觉接口路径不能为空');

    const requestBody = {
        imageBase64: imageBuffer.toString('base64'),
        displayId: displayId || null
    };
    if (shortSide !== undefined) requestBody.shortSide = normalizeVisionShortSide(shortSide);
    const body = JSON.stringify(requestBody);
    const requestUrl = appendVisionPath(serverUrl, endpointPath);
    const candidates = [requestUrl];
    if (requestUrl.protocol === 'http:' && isLoopbackUrl(requestUrl)) {
        const httpsUrl = new URL(requestUrl.toString());
        httpsUrl.protocol = 'https:';
        candidates.push(httpsUrl);
    }

    let lastError = null;
    for (const candidate of candidates) {
        try {
            return await requestJsonOnce(candidate, body, timeoutMs);
        } catch (error) {
            lastError = error;
            // HTTP 状态码代表路由已收到请求，不应切换协议造成重复推理。
            if (error.statusCode || candidate === candidates[candidates.length - 1]) throw error;
        }
    }
    throw lastError || new Error('视觉接口请求失败');
}

function createVisionTask({ id, name, description, path: endpointPath, extraParams = [] }) {
    return {
        id,
        name,
        description,
        target: 'server',
        mode: 'one-shot',
        params: [
            { name: 'serverUrl', type: 'string', required: false, default: DEFAULT_SERVER_URL, label: '视觉服务器 URL' },
            { name: 'targetDisplay', type: 'string', required: false, default: '', label: '目标显示端 ID' },
            { name: 'imageFileName', type: 'string', required: false, default: '', label: '图片文件名' }
        ].concat(extraParams),
        async run(context = {}) {
            try {
                const params = context.params || {};
                const taskConfig = context.taskIO && typeof context.taskIO.getTaskConfig === 'function'
                    ? await context.taskIO.getTaskConfig(context.taskName || id)
                    : {};
                const config = taskConfig && typeof taskConfig === 'object' ? taskConfig : {};
                const serverUrl = normalizeServerUrl(params.serverUrl || config.serverUrl || DEFAULT_SERVER_URL);
                const image = resolveImageFile(context.files, params.imageFileName);
                if (!image) throw new Error('缺少图片文件');

                const requestVision = context.requestVision || requestVisionJson;
                const request = {
                    serverUrl,
                    path: endpointPath,
                    image: image.data,
                    imageFileName: image.name,
                    displayId: params.targetDisplay || null
                };
                if (endpointPath === '/api/vision/ocr') request.shortSide = normalizeVisionShortSide(params.shortSide);
                const response = await requestVision(request);
                return {
                    success: true,
                    data: response
                };
            } catch (error) {
                throw new Error(`${name} 任务执行失败: ${error.message}`);
            }
        }
    };
}

module.exports = {
    DEFAULT_SERVER_URL,
    DEFAULT_TIMEOUT_MS,
    normalizeServerUrl,
    normalizeVisionShortSide,
    requestVisionJson,
    createVisionTask
};
