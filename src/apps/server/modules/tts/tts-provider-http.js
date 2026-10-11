'use strict';

const http = require('node:http');
const https = require('node:https');
const { wrapPcm, adjustWav, decodeAudio, MAX_AUDIO_BYTES } = require('../../../../external/tts/tts-wav');

// 所有网络响应都有总时限与容量边界；错误体不进入日志，避免回显密钥或签名链接。
function requestLimited(url, { method = 'GET', body, headers = {}, timeoutMs = 60000,
    maxBytes = MAX_AUDIO_BYTES, onChunk = null, mapError = null } = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
            reject(new Error('TTS 上游地址无效'));
            return;
        }
        const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
        let chunks = [];
        let received = 0;
        let response = null;
        let httpError = null;
        let settled = false;
        const transport = target.protocol === 'https:' ? https : http;
        const req = transport.request(target, { method, headers: {
            ...headers, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
        } });
        const timer = setTimeout(() => finish(Object.assign(new Error('TTS 上游请求超时'), { code: 'TTS_PROVIDER_TIMEOUT' })), timeoutMs);

        function finish(error, value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            chunks = [];
            if (error) {
                response?.destroy();
                req.destroy();
                reject(error);
                return;
            }
            resolve(value);
        }

        req.on('error', () => finish(httpError || new Error('TTS 上游连接失败')));
        req.on('response', res => {
            response = res;
            if (res.statusCode < 200 || res.statusCode >= 300) {
                httpError = new Error([401, 403].includes(res.statusCode)
                    ? 'TTS Provider 凭证失效或权限不足，请更新凭证' : `TTS 上游 HTTP ${res.statusCode}`);
                httpError.code = [401, 403].includes(res.statusCode) ? 'TTS_PROVIDER_AUTH' : 'TTS_PROVIDER_HTTP';
                // 默认调用仍立即拒绝；仅合成接口显式启用小错误体解析，音频下载不受影响。
                if (typeof mapError !== 'function') return finish(httpError);
                httpError = mapHttpError(null);
            }
            // 映射回调异常或返回非Error时仍保留受控HTTP错误，不把响应误当音频处理。
            function mapHttpError(result) {
                try {
                    const mapped = mapError(result, res.statusCode);
                    return mapped instanceof Error ? mapped : httpError;
                } catch (error) {
                    return httpError;
                }
            }
            const limit = httpError ? Math.min(maxBytes, 16 * 1024) : maxBytes;
            if (Number(res.headers['content-length']) > limit) {
                finish(httpError || new Error('TTS 上游响应超过容量上限'));
                return;
            }
            res.on('error', () => finish(httpError || new Error('TTS 上游响应中断')));
            res.on('aborted', () => finish(httpError || new Error('TTS 上游响应中断')));
            res.on('data', chunk => {
                if (settled) return;
                received += chunk.length;
                if (received > limit) {
                    finish(httpError || new Error('TTS 上游响应超过容量上限'));
                    return;
                }
                try {
                    if (onChunk && !httpError) onChunk(chunk);
                    else chunks.push(chunk);
                } catch (error) {
                    finish(error);
                }
            });
            res.on('end', () => {
                if (settled) return;
                if (!res.complete) return finish(httpError || new Error('TTS 上游响应不完整'));
                if (httpError) {
                    try {
                        const result = JSON.parse(Buffer.concat(chunks, received).toString('utf8'));
                        finish(mapHttpError(result));
                    } catch (error) {
                        finish(httpError);
                    }
                    return;
                }
                finish(null, { buffer: onChunk ? null : Buffer.concat(chunks, received), headers: res.headers });
            });
        });
        req.end(payload);
    });
}

async function requestJson(url, options = {}) {
    const { buffer } = await requestLimited(url, { maxBytes: 1024 * 1024, ...options });
    try {
        return JSON.parse(buffer.toString('utf8'));
    } catch (error) {
        throw new Error('TTS 上游返回了无效 JSON');
    }
}

module.exports = { MAX_AUDIO_BYTES, requestLimited, requestJson, decodeAudio, wrapPcm, adjustWav };
