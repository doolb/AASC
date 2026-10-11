'use strict';

const { PROVIDERS, normalizeVoiceConfig, validateBusinessProvider } = require('./tts-provider-policy');
const SELECTION_BUSINESSES = Object.freeze({ aiReplyDefault: 'ai_reply', textMedia: 'text_media', systemBroadcast: 'system_broadcast' });
const PROVIDER_DEFAULTS = Object.freeze({
    system: { enabled: true, endpoint: '', model: '', credential: '', defaultVoice: null, defaultSpeed: 0, defaultVolume: 100, resourceId: '' },
    'qwen-api': { enabled: false, endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        model: 'qwen3-tts-flash', credential: '', defaultVoice: 'Cherry', defaultSpeed: 0, defaultVolume: 100, resourceId: '' },
    'doubao-api': { enabled: false, endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
        model: '', credential: '', defaultVoice: 'zh_female_vv_uranus_bigtts', defaultSpeed: 0, defaultVolume: 100, resourceId: 'seed-tts-2.0' },
    'qwen-chat': { enabled: false, endpoint: 'https://speech-tts.qianwen.com/api/v3/tts', model: 'QUARK_VOICE', credential: '',
        defaultVoice: 'zh_female_quarkF531S0_ptts', defaultSpeed: 0, defaultVolume: 100, resourceId: '' }
});

function normalizeNumber(value, fallback, min, max) {
    if (value === undefined) return fallback;
    const number = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
    if (!Number.isFinite(number)) throw new Error('TTS 参数必须为有限数字');
    return Math.min(max, Math.max(min, Math.round(number)));
}

function boundedString(value, fallback, max = 512) {
    if (value === undefined) return fallback;
    if (value === null) return '';
    if (typeof value !== 'string' || value.length > max || /[\r\n]/u.test(value)) throw new Error('TTS 参数字符串不合法');
    return value.trim();
}

function normalizeProviderSettings(provider, patch = {}, previous = {}) {
    if (!PROVIDERS.includes(provider)) throw new Error('不支持的 TTS Provider');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Provider 配置必须为对象');
    const base = { ...PROVIDER_DEFAULTS[provider], ...previous };
    if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new Error('enabled 必须为布尔值');
    const endpoint = boundedString(patch.endpoint, base.endpoint, 2048);
    if (endpoint) {
        let url;
        try { url = new URL(endpoint); } catch (error) { throw new Error('TTS 端点地址不合法'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('TTS 端点必须是无凭证、查询参数和片段的 HTTP(S) 地址');
        if (provider === 'qwen-chat' && endpoint !== PROVIDER_DEFAULTS['qwen-chat'].endpoint) throw new Error('国内千问网页仅支持官方朗读端点');
    }
    const incomingCredential = boundedString(patch.credential, '', 16384);
    if (patch.clearCredential !== undefined && typeof patch.clearCredential !== 'boolean') throw new Error('clearCredential 必须为布尔值');
    return {
        enabled: patch.enabled ?? base.enabled, endpoint, model: boundedString(patch.model, base.model),
        credential: patch.clearCredential === true ? '' : incomingCredential || base.credential,
        defaultVoice: boundedString(patch.defaultVoice, base.defaultVoice) || null,
        defaultSpeed: normalizeNumber(patch.defaultSpeed, base.defaultSpeed, -10, 10),
        defaultVolume: normalizeNumber(patch.defaultVolume, base.defaultVolume, 0, 100),
        resourceId: boundedString(patch.resourceId, base.resourceId)
    };
}

function normalizeSettings(patch = {}, previous = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('TTS 配置必须为对象');
    const providersPatch = patch.providers === undefined ? {} : patch.providers;
    if (!providersPatch || typeof providersPatch !== 'object' || Array.isArray(providersPatch)) throw new Error('providers 必须为对象');
    for (const key of Object.keys(providersPatch)) {
        if (!PROVIDERS.includes(key)) throw new Error('不支持的 TTS Provider');
    }
    const providers = Object.fromEntries(PROVIDERS.map(id => [id, normalizeProviderSettings(id, providersPatch[id], previous.providers?.[id])]));
    const selections = Object.fromEntries(Object.entries(SELECTION_BUSINESSES).map(([key, business]) => {
        const input = patch[key] === undefined ? previous[key] || {} : patch[key];
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('TTS 选择必须为对象');
        const value = normalizeVoiceConfig({ ...previous[key], ...input });
        validateBusinessProvider(value.provider, business);
        return [key, value];
    }));
    return { ...selections, providers };
}

function redactSettings(settings) {
    return { ...settings, providers: Object.fromEntries(Object.entries(settings.providers).map(([id, value]) => {
        const { credential, ...publicSettings } = value;
        return [id, { ...publicSettings, credentialConfigured: Boolean(credential) }];
    })) };
}

module.exports = { PROVIDER_DEFAULTS, SELECTION_BUSINESSES, normalizeSettings, redactSettings, normalizeNumber };
