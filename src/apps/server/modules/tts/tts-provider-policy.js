'use strict';

// 业务选择对应 .src/framework/tts-provider-configuration.md；模板空 Provider 表示继承。
const PROVIDERS = Object.freeze(['system', 'qwen-chat', 'qwen-api', 'doubao-api']);
const SYSTEM_BROADCAST_PROVIDERS = new Set(['system', 'qwen-api', 'doubao-api']);
const BUSINESS_TYPES = Object.freeze({
    AI_REPLY: 'ai_reply', AGENT_REPLY: 'agent_reply',
    TEXT_MEDIA: 'text_media', SYSTEM_BROADCAST: 'system_broadcast'
});
const BUSINESS_KEYS = Object.freeze({
    ai_reply: 'aiReplyDefault', agent_reply: 'aiReplyDefault',
    text_media: 'textMedia', system_broadcast: 'systemBroadcast'
});

function normalizeOptionalString(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 512) throw new Error('TTS 音色必须为不超过512字符的字符串');
    return value.trim() || null;
}

function normalizeProvider(value, fallback = 'system') {
    const provider = normalizeOptionalString(value) || fallback;
    if (!PROVIDERS.includes(provider)) throw new Error('不支持的 TTS Provider');
    return provider;
}

function normalizeVoiceConfig(value = {}, fallback = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TTS 选择必须为对象');
    return {
        provider: normalizeProvider(value.provider, fallback.provider || 'system'),
        voice: normalizeOptionalString(value.voice) || normalizeOptionalString(fallback.voice)
    };
}

function normalizeTemplateTts(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模板 TTS 配置必须为对象');
    const provider = normalizeOptionalString(value.provider);
    return {
        ...(provider ? { provider: normalizeProvider(provider) } : {}),
        voice: normalizeOptionalString(value.voice)
    };
}

function validateBusinessProvider(provider, businessType) {
    if (!Object.hasOwn(BUSINESS_KEYS, businessType)) throw new Error('不支持的 TTS 业务类型: ' + businessType);
    const normalizedProvider = normalizeProvider(provider);
    if (![BUSINESS_TYPES.AI_REPLY, BUSINESS_TYPES.AGENT_REPLY].includes(businessType)
        && !SYSTEM_BROADCAST_PROVIDERS.has(normalizedProvider)) throw new Error('qwen-chat 仅允许用于 AI 回复');
    return normalizedProvider;
}

function resolveProviderConfig({ templateTts = null, aiReplyDefault = null,
    systemBroadcast = null, textMedia = null, providers = {}, businessType }) {
    const defaults = { aiReplyDefault, systemBroadcast, textMedia };
    const base = normalizeVoiceConfig(defaults[BUSINESS_KEYS[businessType]] || {});
    const isAi = [BUSINESS_TYPES.AI_REPLY, BUSINESS_TYPES.AGENT_REPLY].includes(businessType);
    const template = isAi && templateTts ? normalizeTemplateTts(templateTts) : {};
    const provider = validateBusinessProvider(template.provider || base.provider, businessType);
    // 只有同一 Provider 的音色 ID 才能继承，云端服务的音色名称并不通用。
    const voice = template.voice || (base.provider === provider ? base.voice : null)
        || normalizeOptionalString(providers[provider]?.defaultVoice);
    return { provider, voice };
}

module.exports = { BUSINESS_TYPES, BUSINESS_KEYS, PROVIDERS, SYSTEM_BROADCAST_PROVIDERS,
    normalizeProvider, normalizeVoiceConfig, normalizeTemplateTts, normalizeOptionalString,
    resolveProviderConfig, validateBusinessProvider };
