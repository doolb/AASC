'use strict';

const http = require('node:http');
const https = require('node:https');
const { wrapPcm, adjustWav, decodeAudio, MAX_AUDIO_BYTES } = require('../../../../external/tts/tts-wav');

// 所有网络响应都有总时限与容量边界；错误体不进入日志，避免回显密钥或签名链接。
function requestLimited(url, { method = 'GET', body, headers = {}, timeoutMs = 60000,
    maxBytes = MAX_AUDIO_BYTES, onChunk = null } = {}) {
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

        req.on('error', () => finish(new Error('TTS 上游连接失败')));
        req.on('response', res => {
            response = res;
            if (res.statusCode < 200 || res.statusCode >= 300) {
                const error = new Error([401, 403].includes(res.statusCode)
                    ? 'TTS Provider 凭证失效或权限不足，请更新凭证' : `TTS 上游 HTTP ${res.statusCode}`);
                error.code = [401, 403].includes(res.statusCode) ? 'TTS_PROVIDER_AUTH' : 'TTS_PROVIDER_HTTP';
                finish(error);
                return;
            }
            if (Number(res.headers['content-length']) > maxBytes) {
                finish(new Error('TTS 上游响应超过容量上限'));
                return;
            }
            res.on('error', () => finish(new Error('TTS 上游响应中断')));
            res.on('aborted', () => finish(new Error('TTS 上游响应中断')));
            res.on('data', chunk => {
                if (settled) return;
                received += chunk.length;
                if (received > maxBytes) {
                    finish(new Error('TTS 上游响应超过容量上限'));
                    return;
                }
                try {
                    if (onChunk) onChunk(chunk);
                    else chunks.push(chunk);
                } catch (error) {
                    finish(error);
                }
            });
            res.on('end', () => {
                if (settled) return;
                if (!res.complete) return finish(new Error('TTS 上游响应不完整'));
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
