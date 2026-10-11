'use strict';

const { randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { requestLimited, requestJson, decodeAudio, wrapPcm, adjustWav, MAX_AUDIO_BYTES } = require('./tts-provider-http');
const { createQwenChatProvider } = require('./qwen-chat-tts');
const { createProviderError } = require('./tts-provider-errors');
const { resolveQwenEndpoint, createQwenInput } = require('./qwen-api-contract');
const { normalizeQwenWav, validateWav } = require('../../../../external/tts/tts-wav');
const { createDoubaoAdditions } = require('./tts-reply-user-text');

// 音色目录为官方常用候选，允许用户填目录外ID；权限和最终可用性由上游合成校验。
const VOICE_CATALOGS = Object.freeze({
    'qwen-api': ['Cherry', 'Ethan', 'Chelsie', 'Serena'],
    'doubao-api': ['zh_female_vv_uranus_bigtts']
});

function ensureEnabled(settings) {
    if (!settings.enabled) throw new Error('TTS Provider 未启用，请先保存配置');
    if (!settings.credential) throw Object.assign(new Error('TTS Provider 未配置凭证'), { code: 'TTS_PROVIDER_AUTH' });
}

function createProviderRegistry({ systemGenerate, systemVoices = async () => [],
    qwenChat = null, chat2ApiSpeechService, httpRequest = requestLimited, jsonRequest = requestJson } = {}) {
    const download = async (url, timeoutMs) => {
        // 音频URL可能属于对象存储；绝不沿用Provider的Authorization/Cookie。
        const result = await httpRequest(url, { timeoutMs });
        return result.buffer;
    };
    const qwenApi = {
        async generate(request, settings) {
            ensureEnabled(settings);
            if ([...request.text].length > 600) throw new Error('Qwen TTS 单次文本不能超过600字符');
            const deadline = Date.now() + request.timeoutMs;
            const result = await jsonRequest(resolveQwenEndpoint(settings.endpoint, settings.model), {
                method: 'POST', timeoutMs: request.timeoutMs,
                headers: { Authorization: `Bearer ${settings.credential}` },
                mapError: (result, status) => createProviderError('qwen-api', result, status),
                body: { model: settings.model, input: createQwenInput(request, settings.model) }
            });
            if (result.code || (result.status_code && result.status_code !== 200)) throw createProviderError('qwen-api', result);
            if (!result.output?.audio?.url) throw new Error('Qwen TTS 合成失败，响应缺少音频地址，请检查模型、音色和凭证');
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error('TTS 上游请求超时');
            const wav = normalizeQwenWav(await download(result.output.audio.url, remaining));
            validateWav(wav);
            return adjustWav(wav, request.speed, request.volume);
        },
        async voices(settings = {}) {
            const voices = settings.model === 'qwen-audio-3.1-tts-flash' ? ['qiaoxiaojiao_v3.1']
                : settings.model?.startsWith('qwen-audio-') ? [] : VOICE_CATALOGS['qwen-api'];
            return voices.map(id => ({ id, name: id === 'qiaoxiaojiao_v3.1' ? '乔小娇' : id, available: true }));
        }
    };
    const doubaoApi = {
        async generate(request, settings) {
            ensureEnabled(settings);
            const chunks = [];
            let bytes = 0;
            let pending = '';
            let completed = false;
            const decoder = new StringDecoder('utf8');
            const additions = createDoubaoAdditions(request, settings);
            const consumeLine = line => {
                const text = line.trim().replace(/^data:\s*/u, '');
                if (!text || /^(event:|:)/u.test(text)) return;
                let event;
                try { event = JSON.parse(text); } catch (error) { throw new Error('豆包 TTS 返回无效流事件'); }
                if (![0, 20000000].includes(event.code)) throw createProviderError('doubao-api', event);
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
            await httpRequest(settings.endpoint, {
                method: 'POST', timeoutMs: request.timeoutMs, maxBytes: 24 * 1024 * 1024,
                headers: { 'X-Api-Key': settings.credential, 'X-Api-Resource-Id': settings.resourceId, 'X-Api-Request-Id': randomUUID() },
                mapError: (result, status) => createProviderError('doubao-api', result, status),
                body: { user: { uid: 'aasc' }, req_params: { text: request.text, speaker: request.voice,
                    ...(settings.model ? { model: settings.model } : {}),
                    ...(additions ? { additions } : {}),
                    audio_params: { format: 'pcm', sample_rate: 24000,
                        speech_rate: Math.round((Math.pow(2, request.speed / 10) - 1) * 100) } } },
                onChunk: chunk => consume(decoder.write(chunk))
            });
            consume(decoder.end());
            if (pending.trim()) consumeLine(pending);
            if (!completed) throw new Error('豆包 TTS 未收到合成完成事件');
            return adjustWav(wrapPcm(Buffer.concat(chunks, bytes)), 0, request.volume);
        },
        async voices() { return VOICE_CATALOGS['doubao-api'].map(id => ({ id, name: id, available: true })); }
    };
    return Object.freeze({
        system: { generate: systemGenerate, voices: systemVoices },
        'qwen-api': qwenApi, 'doubao-api': doubaoApi,
        'qwen-chat': qwenChat || createQwenChatProvider({ speechService: chat2ApiSpeechService })
    });
}

module.exports = { createProviderRegistry, VOICE_CATALOGS, ensureEnabled };
