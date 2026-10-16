'use strict';

const { randomUUID } = require('node:crypto');
const { QWEN_AUDIO_31_MODEL, listQwenAudio31Voices } = require('./chat2api-qwen-audio-voices');
const { assertFixedQwenTtsModel, normalizeQwenApiVoice } = require('./chat2api-qwen-tts-models');
const { StringDecoder } = require('node:string_decoder');
const { requestLimited, requestJson } = require('../tts/tts-provider-http');
const { createProviderError } = require('../tts/tts-provider-errors');
const { resolveQwenEndpoint, createQwenInput, isQwenAudioModel } = require('../tts/qwen-api-contract');
const { createDoubaoAdditions } = require('../tts/tts-reply-user-text');
const { MAX_AUDIO_BYTES, decodeAudio, wrapPcm, normalizeQwenWav, adjustWavVolume, validateWav } = require('../../../../external/tts/tts-wav');

const ENDPOINTS = Object.freeze({
    'qwen-api': 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
    doubaapi: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
});
const VOICES = Object.freeze({ doubaapi: ['zh_female_vv_uranus_bigtts'] });
const abortError = () => Object.assign(new Error('TTS 上游请求已取消'), { name: 'AbortError', code: 'ABORT_ERR' });
const timeoutError = () => Object.assign(new Error('TTS 上游请求超时'), { code: 'TTS_PROVIDER_TIMEOUT' });

function validateRequest(request, credential) {
    if (typeof credential !== 'string' || !credential || credential.length > 8192 || !/^[\x21-\x7e]+$/u.test(credential)) {
        throw Object.assign(new Error('TTS Provider 未配置有效 API 凭证'), { code: 'TTS_PROVIDER_AUTH' });
    }
    if (typeof request?.text !== 'string' || !request.text.trim() || !/[\p{L}\p{N}]/u.test(request.text)) throw new Error('TTS 文本没有可朗读内容');
    const speed = request.speed ?? 1;
    const volume = request.volume ?? 100;
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.25 || speed > 4
        || typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 100) throw new Error('TTS 速度或音量超出范围');
    if (isQwenAudioModel(request.model) && (speed < 0.5 || speed > 2)) throw new Error('Qwen-Audio TTS 原生语速范围为0.5至2');
    if (typeof request.voice !== 'string' || !request.voice.trim() || request.voice.length > 512 || /[\r\n\x00-\x1f]/u.test(request.voice)) throw new Error('TTS 音色无效');
    if (request.model !== undefined && (typeof request.model !== 'string' || request.model.length > 512 || /[\r\n\x00-\x1f]/u.test(request.model))) throw new Error('TTS 模型无效');
    return { ...request, speed, volume };
}

function resolveEndpoint(providerId, context, model) {
    try {
        const endpoint = context.provider?.apiEndpoint || ENDPOINTS[providerId];
        const url = new URL(endpoint);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid endpoint');
        return providerId === 'qwen-api' ? resolveQwenEndpoint(endpoint, model) : endpoint;
    } catch (error) { throw new Error('TTS 上游地址无效'); }
}

// 同一次生成只创建一个截止时间，下载、流读取与本地WAV变换均检查剩余预算。
// request与context的取消源可以不同；生成结束后移除全部监听，不保留账号或凭证。
function createBudget(request, context) {
    const timeoutMs = request.timeoutMs ?? 60000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || (context.deadline !== undefined && !Number.isFinite(context.deadline))) throw new Error('TTS 超时参数无效');
    const deadline = Math.min(Date.now() + Math.min(timeoutMs, 60000), context.deadline ?? Infinity);
    const signals = [...new Set([request.signal, context.signal].filter(Boolean))];
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const remaining = () => {
        if (signals.some(signal => signal.aborted)) throw abortError();
        const duration = deadline - Date.now();
        if (duration <= 0) throw timeoutError();
        return duration;
    };
    remaining();
    for (const signal of signals) signal.addEventListener('abort', onAbort, { once: true });
    return { signal: controller.signal, remaining, dispose() { for (const signal of signals) signal.removeEventListener('abort', onAbort); } };
}

function createApiSpeechAdapters({ httpRequest = requestLimited, jsonRequest = requestJson } = {}) {
    const withBudget = generate => async (request, credential, context = {}) => {
        const normalized = validateRequest(request, credential);
        const budget = createBudget(normalized, context);
        try {
            const audio = await generate(normalized, credential, context, budget);
            budget.remaining();
            validateWav(audio);
            return audio;
        } finally { budget.dispose(); }
    };
    const qwenApi = {
        generate: withBudget(async (request, credential, context, budget) => {
            if (Array.from(request.text).length > 600) throw new Error('Qwen TTS 单次文本不能超过600字符');
            assertFixedQwenTtsModel('qwen-api', request.model);
            request = { ...request, model: QWEN_AUDIO_31_MODEL, voice: normalizeQwenApiVoice(request.voice) };
            const endpoint = resolveEndpoint('qwen-api', context, request.model);
            const result = await jsonRequest(endpoint, {
                method: 'POST', timeoutMs: budget.remaining(), signal: budget.signal,
                headers: { Authorization: `Bearer ${credential}` },
                mapError: (result, status) => createProviderError('qwen-api', result, status),
                body: { model: request.model, input: createQwenInput(request, request.model) }
            });
            budget.remaining();
            if (result?.code || (result?.status_code && result.status_code !== 200)) throw createProviderError('qwen-api', result);
            if (!result?.output?.audio?.url) throw new Error('Qwen TTS 合成失败，响应缺少音频地址，请检查模型、音色和凭证');
            // 对象存储下载不得携带任何Provider认证头，也不跟随重定向。
            const downloaded = await httpRequest(result.output.audio.url, { timeoutMs: budget.remaining(), signal: budget.signal, maxBytes: MAX_AUDIO_BYTES });
            budget.remaining();
            const wav = normalizeQwenWav(downloaded.buffer);
            validateWav(wav);
            return adjustWavVolume(wav, request.volume);
        }),
        async voices(request = {}) {
            assertFixedQwenTtsModel('qwen-api', request.model ?? QWEN_AUDIO_31_MODEL);
            return listQwenAudio31Voices();
        }
    };
    const doubaoApi = {
        generate: withBudget(async (request, credential, context, budget) => {
            const endpoint = resolveEndpoint('doubaapi', context, request.model);
            const resourceId = context.provider?.resourceId || 'seed-tts-2.0';
            if (typeof resourceId !== 'string' || resourceId.length > 512 || !/^[\x21-\x7e]+$/u.test(resourceId)) throw new Error('豆包 TTS 资源ID无效');
            const chunks = [];
            let bytes = 0;
            let pending = '';
            let completed = false;
            const decoder = new StringDecoder('utf8');
            // 上一句仅允许业务薄层通过专用context带入，仍复用原业务/资源/复刻模型限制。
            const additions = createDoubaoAdditions(context.legacyReplyContext || {}, { resourceId, model: request.model });
            const consumeLine = line => {
                const text = line.trim().replace(/^data:\s*/u, '');
                if (!text || /^(event:|:)/u.test(text)) return;
                let event;
                try { event = JSON.parse(text); } catch (error) { throw new Error('豆包 TTS 返回无效流事件'); }
                if (!event || ![0, 20000000].includes(event.code)) throw createProviderError('doubao-api', event);
                if (completed) throw new Error('豆包 TTS 完成后收到多余事件');
                if (event.data) {
                    const chunk = decodeAudio(event.data);
                    bytes += chunk.length;
                    if (bytes + 44 > MAX_AUDIO_BYTES) throw new Error('TTS 音频超过16MiB上限');
                    chunks.push(chunk);
                }
                completed = event.code === 20000000;
            };
            const consume = text => {
                pending += text;
                let newline;
                while ((newline = pending.indexOf('\n')) !== -1) {
                    consumeLine(pending.slice(0, newline));
                    pending = pending.slice(newline + 1);
                }
                if (pending.length > 24 * 1024 * 1024) throw new Error('豆包 TTS 单事件超过容量上限');
            };
            await httpRequest(endpoint, {
                method: 'POST', timeoutMs: budget.remaining(), signal: budget.signal, maxBytes: 24 * 1024 * 1024,
                headers: { 'X-Api-Key': credential, 'X-Api-Resource-Id': resourceId, 'X-Api-Request-Id': randomUUID() },
                mapError: (result, status) => createProviderError('doubao-api', result, status),
                body: { user: { uid: 'aasc' }, req_params: { text: request.text, speaker: request.voice,
                    ...(request.model ? { model: request.model } : {}), ...(additions ? { additions } : {}),
                    audio_params: { format: 'pcm', sample_rate: 24000, speech_rate: Math.round((request.speed - 1) * 100) } } },
                onChunk: chunk => { budget.remaining(); consume(decoder.write(chunk)); }
            });
            budget.remaining();
            consume(decoder.end());
            if (pending.trim()) consumeLine(pending);
            if (!completed) throw new Error('豆包 TTS 未收到合成完成事件');
            return adjustWavVolume(wrapPcm(Buffer.concat(chunks, bytes)), request.volume);
        }),
        async voices() { return VOICES.doubaapi.map(id => ({ id, name: id, available: true })); }
    };
    return Object.freeze({ 'qwen-api': qwenApi, doubaapi: doubaoApi });
}

module.exports = { createApiSpeechAdapters };
