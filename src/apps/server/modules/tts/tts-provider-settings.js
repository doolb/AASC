'use strict';

const { PROVIDERS, normalizeVoiceConfig, validateBusinessProvider } = require('./tts-provider-policy');
const { resolveQwenEndpoint } = require('./qwen-api-contract');
const { DOUBAO_SPEECH_VOICE } = require('../chat2api/chat2api-doubao-speech-protocol');
const SELECTION_BUSINESSES = Object.freeze({ aiReplyDefault: 'ai_reply', textMedia: 'text_media', systemBroadcast: 'system_broadcast' });
const QWEN_CHAT_MODELS = new Set(['QUARK_VOICE', 'MINI_MAX']);
const PROVIDER_DEFAULTS = Object.freeze({
    system: { endpoint: '', model: '', credential: '', resourceId: '' },
    'qwen-api': { enabled: true, endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
        model: 'qwen-audio-3.1-tts-flash', credential: '', defaultVoice: 'qiaoxiaojiao_v3.1', resourceId: '' },
    'doubao-api': { enabled: true, endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
        model: '', credential: '', defaultVoice: 'zh_female_vv_uranus_bigtts', resourceId: 'seed-tts-2.0' },
    'doubao-chat': { enabled: false, endpoint: 'https://www.doubao.com', model: 'doubao-chat',
        defaultVoice: DOUBAO_SPEECH_VOICE, resourceId: '', experimental: true },
    'qwen-chat': { enabled: true, endpoint: 'https://speech-tts.qianwen.com/api/v3/tts', model: 'QUARK_VOICE',
        defaultVoice: 'zh_female_quarkF531S0_ptts', resourceId: '' }
});

function normalizeNumber(value, fallback, min, max) {
    const input = value === undefined ? fallback : value;
    const number = typeof input === 'number' || (typeof input === 'string' && input.trim()) ? Number(input) : NaN;
    if (!Number.isFinite(number)) throw new Error('TTS 参数必须为有限数字');
    return Math.min(max, Math.max(min, Math.round(number)));
}

function boundedString(value, fallback, max = 512) {
    if (value === undefined) return fallback;
    if (value === null) return '';
    if (typeof value !== 'string' || value.length > max || /[\r\n]/u.test(value)) throw new Error('TTS 参数字符串不合法');
    return value.trim();
}

function normalizeProviderSettings(provider, patch = {}, previous = {}, { recoverLegacyModel = false } = {}) {
    if (!PROVIDERS.includes(provider)) throw new Error('不支持的 TTS Provider');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Provider 配置必须为对象');
    if (provider === 'doubao-chat') {
        const fixed = PROVIDER_DEFAULTS[provider];
        const allowed = new Set(['enabled', 'endpoint', 'model', 'defaultVoice', 'defaultSpeed', 'defaultVolume', 'resourceId', 'experimental']);
        if (Object.keys(patch).some(key => !allowed.has(key))) throw new Error('豆包网页朗读配置不接受凭据、账号或额外参数');
        if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new Error('enabled 必须为布尔值');
        // 规范化后的配置会再次用于重载；固定实验性标识可原样读回，但不能由控制端取消。
        if (patch.experimental !== undefined && patch.experimental !== true) throw new Error('豆包网页朗读目前只能作为实验性来源');
        for (const key of ['endpoint', 'model', 'defaultVoice', 'resourceId']) {
            if (patch[key] !== undefined && patch[key] !== fixed[key]) throw new Error('豆包网页朗读仅支持固定网页默认配置');
        }
        // 忽略历史Provider专属速度/音量；共享值由全局字段统一校验和保存。
        // 任何旧凭据/账号引用均不进入新配置或广播。
        return { ...fixed, enabled: patch.enabled ?? (typeof previous.enabled === 'boolean' ? previous.enabled : false) };
    }
    const base = { ...PROVIDER_DEFAULTS[provider], ...previous };
    if (provider !== 'system' && patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new Error('enabled 必须为布尔值');
    const endpoint = boundedString(patch.endpoint, base.endpoint, 2048);
    if (endpoint) {
        let url;
        try { url = new URL(endpoint); } catch (error) { throw new Error('TTS 端点地址不合法'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('TTS 端点必须是无凭证、查询参数和片段的 HTTP(S) 地址');
        if (provider === 'qwen-chat' && endpoint !== PROVIDER_DEFAULTS['qwen-chat'].endpoint) throw new Error('国内千问网页仅支持官方朗读端点');
    }
    // 国内网页由Chat2API管理账号；旧手动值和账号引用均不进入新配置或广播。
    const incomingCredential = provider === 'qwen-chat' ? '' : boundedString(patch.credential, '', 16384);
    const auth = provider === 'qwen-chat'
        ? {}
        : { credential: patch.clearCredential === true ? '' : incomingCredential || base.credential };
    if (provider !== 'qwen-chat' && patch.clearCredential !== undefined && typeof patch.clearCredential !== 'boolean') throw new Error('clearCredential 必须为布尔值');
    let model = boundedString(patch.model, base.model);
    let mappedModel=false;
    if (provider === 'qwen-chat') {
        if (model === 'qwen-chat') model = 'QUARK_VOICE';
        const reserved=/^(?:qwen(?:\d|[-_])|QUARK_|MINI_)/iu.test(model);
        const alias=/^[\w.\/-]{1,200}$/u.test(model)&&!reserved;
        if (!QWEN_CHAT_MODELS.has(model) && (!alias || (recoverLegacyModel && patch.mappedModel!==true && base.mappedModel!==true))) {
            // 对应.src/framework/qwen-chat-restore-and-model.md：历史错误配置可读，新提交必须明确拒绝。
            if (!recoverLegacyModel) throw new Error('国内千问网页模型仅支持 QUARK_VOICE 或 MINI_MAX；qwen3-tts-flash 请使用 Qwen API');
            model = PROVIDER_DEFAULTS['qwen-chat'].model;
        }
        mappedModel=!QWEN_CHAT_MODELS.has(model);
    }
    return {
        endpoint: provider === 'qwen-api' && endpoint ? resolveQwenEndpoint(endpoint, model) : endpoint, model,
        ...(mappedModel?{mappedModel:true}:{}),
        ...auth,
        ...(provider === 'system' ? {} : { enabled: patch.enabled ?? base.enabled,
            defaultVoice: boundedString(patch.defaultVoice, base.defaultVoice) || null }),
        resourceId: boundedString(patch.resourceId, base.resourceId)
    };
}

function migratedSharedParameter(name, patch, previous) {
    const selectedProvider = patch.aiReplyDefault?.provider || previous.aiReplyDefault?.provider || 'system';
    const legacyProvider = { ...previous.providers?.[selectedProvider], ...patch.providers?.[selectedProvider] };
    const fallback = name === 'defaultSpeed' ? 0 : 100;
    return legacyProvider[name] === undefined ? previous[name] ?? fallback : legacyProvider[name];
}

function normalizeSettings(patch = {}, previous = {}, options = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('TTS 配置必须为对象');
    const providersPatch = patch.providers === undefined ? {} : patch.providers;
    if (!providersPatch || typeof providersPatch !== 'object' || Array.isArray(providersPatch)) throw new Error('providers 必须为对象');
    for (const key of Object.keys(providersPatch)) {
        if (!PROVIDERS.includes(key)) throw new Error('不支持的 TTS Provider');
    }
    const providers = Object.fromEntries(PROVIDERS.map(id => [id, normalizeProviderSettings(id, providersPatch[id], previous.providers?.[id], options)]));
    const selections = Object.fromEntries(Object.entries(SELECTION_BUSINESSES).map(([key, business]) => {
        const input = patch[key] === undefined ? previous[key] || {} : patch[key];
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('TTS 选择必须为对象');
        const value = normalizeVoiceConfig({ ...previous[key], ...input });
        if (value.provider === 'doubao-chat') {
            if (input.provider === 'doubao-chat' && input.voice === undefined && previous[key]?.provider !== 'doubao-chat') value.voice = null;
            if (value.voice && value.voice !== DOUBAO_SPEECH_VOICE) throw new Error('豆包网页朗读仅支持网页默认音色');
        }
        validateBusinessProvider(value.provider, business);
        return [key, value];
    }));
    const defaultSpeed = normalizeNumber(patch.defaultSpeed, migratedSharedParameter('defaultSpeed', patch, previous), -10, 10);
    const defaultVolume = normalizeNumber(patch.defaultVolume, migratedSharedParameter('defaultVolume', patch, previous), 0, 100);
    return { ...selections, defaultSpeed, defaultVolume, providers };
}

function redactSettings(settings) {
    return { ...settings, providers: Object.fromEntries(Object.entries(settings.providers).map(([id, value]) => {
        const { credential, ...publicSettings } = value;
        // API旧秘密仍在私有配置供回滚；公共页面和生成链不再使用或宣传该值的配置状态。
        if(['qwen-api','doubao-api'].includes(id)){
            const {endpoint,resourceId,...preferences}=publicSettings;
            return [id,{...preferences,credentialSource:'chat2api'}];
        }
        return [id,publicSettings];
    })) };
}

module.exports = { PROVIDER_DEFAULTS, SELECTION_BUSINESSES, normalizeSettings, redactSettings, normalizeNumber };
