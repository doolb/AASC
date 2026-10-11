'use strict';

const audioCache = require('../../../../external/tts/tts-audio-cache');
const { BUSINESS_TYPES, resolveProviderConfig, normalizeProvider, normalizeOptionalString } = require('./tts-provider-policy');
const { normalizeNumber } = require('./tts-provider-settings');
const { validateWav } = require('../../../../external/tts/tts-wav');
const { isReplyBusiness, normalizeReplyUserText } = require('./tts-reply-user-text');

// Provider负责生成，业务层仍使用原音频引用、队列、目标和打断协议。
function createTtsProviderService({ getSettings, registry, storeAudio = audioCache.storeAudio,
    timeoutMs = 60000 } = {}) {
    const resolve = request => {
        const settings = getSettings();
        const selection = resolveProviderConfig({ ...settings, templateTts: request.templateTts,
            businessType: request.businessType || BUSINESS_TYPES.SYSTEM_BROADCAST });
        const providerSettings = settings.providers[selection.provider];
        return { settings: providerSettings, selection };
    };
    return {
        resolve,
        async generate(request) {
            if (typeof request.text !== 'string' || !request.text.trim()) throw new Error('TTS 文本不能为空');
            const { settings, selection } = resolve(request);
            const adapter = registry[selection.provider];
            try {
                const { userText, ...providerRequest } = request;
                // 其他Provider和非AI业务不接收上一句对话，避免把聊天内容混进普通播报。
                const replyUserText = selection.provider === 'doubao-api' && isReplyBusiness(request.businessType)
                    ? normalizeReplyUserText(userText) : null;
                const result = await adapter.generate({ ...providerRequest,
                    ...(replyUserText ? { userText: replyUserText } : {}),
                    ...selection, voice: normalizeOptionalString(request.voice) || selection.voice,
                    speed: normalizeNumber(request.speed, settings.defaultSpeed, -10, 10),
                    volume: normalizeNumber(request.volume, settings.defaultVolume, 0, 100), timeoutMs
                }, settings);
                if (selection.provider === 'system') return result;
                // qwen-chat筛选后没有可朗读正文时返回null，播放层跳过该句；不缓存空WAV。
                if (selection.provider === 'qwen-chat' && result === null) return null;
                validateWav(result);
                return storeAudio(result);
            } catch (error) {
                // 适配器只产生受控错误；不拼接HTTP客户端包含敏感header的原始错误对象。
                error.provider = selection.provider;
                throw error;
            }
        },
        async voices(provider) {
            const id = normalizeProvider(provider);
            if (id === 'system') return [];
            const settings = getSettings().providers[id];
            return registry[id].voices(settings);
        }
    };
}

module.exports = { createTtsProviderService };
