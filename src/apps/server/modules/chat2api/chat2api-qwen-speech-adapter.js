'use strict';

const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');
const { createQwenSigner, parseCookies } = require('./chat2api-qwen-speech-auth');
const { decodeAudio, wrapPcm, adjustWav, MAX_AUDIO_BYTES } = require('../../../../external/tts/tts-wav');

const QWEN_TTS_ENDPOINT = 'https://speech-tts.qianwen.com/api/v3/tts';
const QWEN_VOICE = 'zh_female_quarkF531S0_ptts';

function collectQwenAudio(url, request, settings, reqid, { Socket = WebSocket } = {}) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        let lastSequence = -1;
        let finished = false;
        const socket = new Socket(url, { origin: 'https://www.qianwen.com', maxPayload: 24 * 1024 * 1024,
            headers: { Cookie: parseCookies(settings.credential).map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
                ...(request.userAgent ? { 'User-Agent': request.userAgent } : {}) },
            handshakeTimeout: request.timeoutMs });
        const timer = setTimeout(() => finish(new Error('国内千问朗读超时')), request.timeoutMs);
        const finish = (error, audio) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            socket.terminate();
            if (error) reject(error);
            else resolve(audio);
        };
        socket.on('error', () => finish(new Error('国内千问朗读连接失败，请检查登录凭证')));
        socket.on('close', () => finish(new Error('国内千问朗读中断，未收到完成事件')));
        socket.on('open', () => {
            const packet = { reqid, model: settings.model, vcn: request.voice, speed: request.speed,
                type: 'stream', volume: 1, format: 'pcm', sample_rate: settings.model === 'MINI_MAX' ? 32000 : 24000 };
            socket.send(JSON.stringify({ ...packet, text: request.text, status: 1, ced: request.text.length }));
            socket.send(JSON.stringify({ ...packet, text: '', status: 2, ced: request.text.length }));
        });
        socket.on('message', raw => {
            if (finished) return;
            try {
                const event = JSON.parse(String(raw));
                if (event.code && Number(event.code) !== 2000000) throw new Error('国内千问朗读失败，请检查音色与登录凭证');
                const data = event.data || {};
                if (data.audio) {
                    const sequence = data.res_ced;
                    if (sequence !== undefined && (!Number.isFinite(sequence) || sequence < 0)) throw new Error('国内千问音频序号无效');
                    if (sequence === undefined || sequence > lastSequence) {
                        const chunk = decodeAudio(data.audio);
                        bytes += chunk.length;
                        if (bytes + 44 > MAX_AUDIO_BYTES) throw new Error('TTS 音频超过16MiB上限');
                        chunks.push(chunk);
                        if (sequence !== undefined) lastSequence = sequence;
                    }
                }
                if (Number(data.status) === 2 || event.type === 'user.tts.ended') {
                    const sampleRate = settings.model === 'MINI_MAX' ? 32000 : 24000;
                    finish(null, adjustWav(wrapPcm(Buffer.concat(chunks, bytes), sampleRate), 0, request.volume));
                }
            } catch (error) {
                finish(error instanceof SyntaxError ? new Error('国内千问返回无效朗读事件') : error);
            }
        });
    });
}

// Chat2API负责账号与签名，适配器只接收请求内存中的当前凭证。
function createChat2ApiQwenSpeechAdapter({ sign = createQwenSigner(), Socket = WebSocket } = {}) {
    return {
        async generate(request, credential) {
            const deadline = Date.now() + request.timeoutMs;
            const reqid = randomUUID();
            const signed = await sign({ credential, reqid, timeoutMs: request.timeoutMs });
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error('国内千问朗读超时');
            return collectQwenAudio(typeof signed === 'string' ? signed : signed.url,
                { ...request, userAgent: signed.userAgent, timeoutMs: remaining }, { model: request.model, credential }, reqid, { Socket });
        }
    };
}

module.exports = { createChat2ApiQwenSpeechAdapter, createQwenSigner, collectQwenAudio, parseCookies, QWEN_VOICE };
