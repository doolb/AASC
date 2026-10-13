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
        return { settings: providerSettings, selection, configuration:settings };
    };
    return {
        resolve,
        async generate(request) {
            if (typeof request.text !== 'string' || !request.text.trim()) throw new Error('TTS 文本不能为空');
            const { settings, selection, configuration } = resolve(request);
            const adapter = registry[selection.provider];
            try {
                const { userText, ...providerRequest } = request;
                // 其他Provider和非AI业务不接收上一句对话，避免把聊天内容混进普通播报。
                const replyUserText = selection.provider === 'doubao-api' && isReplyBusiness(request.businessType)
                    ? normalizeReplyUserText(userText) : null;
                const requestedModel=settings.model;
                const knownModel=selection.provider==='qwen-api'? /^(qwen-audio-|qwen3-tts-)/u.test(requestedModel||'') : selection.provider==='qwen-chat'?['QUARK_VOICE','MINI_MAX'].includes(requestedModel):true;
                const selectedVoice=normalizeOptionalString(request.voice)||selection.voice;
                // 映射别名的默认音色由Chat2API解析；业务没有显式选择时不以旧Provider默认值遮盖映射。
                const businessSelection=configuration?.[({ai_reply:'aiReplyDefault',agent_reply:'aiReplyDefault',text_media:'textMedia',system_broadcast:'systemBroadcast'})[request.businessType||BUSINESS_TYPES.SYSTEM_BROADCAST]];
                const templateVoice=isReplyBusiness(request.businessType)&&selection.provider!=='system'?normalizeOptionalString(request.templateTts?.voice):null;
                const explicitVoice=normalizeOptionalString(request.voice)||templateVoice
                    || (selection.provider!=='system'&&businessSelection?.provider===selection.provider?normalizeOptionalString(businessSelection.voice):null);
                const result = await adapter.generate({ ...providerRequest,
                    ...(replyUserText ? { userText: replyUserText } : {}),
                    ...selection, voice: explicitVoice || (knownModel?selectedVoice:undefined),
                    parameterOverrides:{...(explicitVoice?{voice:explicitVoice}:{}),...(request.speed!==undefined?{speed:Math.pow(2,normalizeNumber(request.speed,0,-10,10)/10)}:{}),...(request.volume!==undefined?{volume:normalizeNumber(request.volume,100,0,100)}:{})},
                    parameterDefaults:{...(settings.defaultVoice?{voice:settings.defaultVoice}:{}),speed:Math.pow(2,settings.defaultSpeed/10),volume:settings.defaultVolume},
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
