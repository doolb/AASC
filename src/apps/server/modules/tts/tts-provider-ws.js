'use strict';
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { BUSINESS_TYPES, PROVIDERS } = require('./tts-provider-policy');
const { supportsNativeSpeed, normalizeNumber } = require('./tts-provider-settings');

const PREVIEW_SENTENCES = Object.freeze([
    '你好，很高兴认识你。',
    '今天的天气真不错。',
    '愿你拥有愉快的一天。',
    '请听听这个声音是否合适。'
]);

// 与AASC控制端handler共用同一权威配置流程，禁止额外HTTP配置接口。
function createTtsProviderWs({ config, service, isControl, isDisplay = () => false, broadcast, onConfigChanged = () => {} }) {
    const message = extra => ({ type: 'ttsProviderConfig', config: config.getPublicTtsProviderSettings(), ...extra });
    return {
        snapshot: message,
        async handle(ws, data) {
            if (!['setTtsProviderConfig', 'getTtsProviderVoices', 'setChatTtsSelection', 'getChatTtsConfig', 'previewTtsVoice'].includes(data.type)) return false;
            const control = isControl(ws);
            if (!control && (!isDisplay(ws) || data.type === 'setTtsProviderConfig')) return true;
            if (data.type === 'previewTtsVoice') {
                const requestId = typeof data.requestId === 'string' && data.requestId.length <= 128 ? data.requestId : null;
                try {
                    // 试听只接受目录项身份；正文由服务端挑选，不能借此提交任意文本或更改配置。
                    const allowed = new Set(['type', 'provider', 'voice', 'requestId']);
                    if (Object.keys(data).some(key => !allowed.has(key)) || !requestId
                        || !PROVIDERS.includes(data.provider) || data.provider === 'system'
                        || typeof data.voice !== 'string' || !data.voice.trim() || data.voice.length > 512) {
                        throw new Error('试听参数不合法');
                    }
                    const text = PREVIEW_SENTENCES[randomInt(PREVIEW_SENTENCES.length)];
                    const audio = await service.generate({ text, businessType: BUSINESS_TYPES.AI_REPLY,
                        templateTts: { provider: data.provider, voice: data.voice }, voice: data.voice });
                    if (!audio) throw new Error('此音色没有可播放的音频');
                    ws.send(JSON.stringify({ type: 'ttsVoicePreview', requestId, success: true,
                        audioUrl: `/uploads/tts/${path.basename(audio)}` }));
                } catch (error) {
                    ws.send(JSON.stringify({ type: 'ttsVoicePreview', requestId, success: false,
                        message: error.message }));
                }
                return true;
            }
            if (data.type === 'getChatTtsConfig') {
                ws.send(JSON.stringify(message()));
                return true;
            }
            if (data.type === 'getTtsProviderVoices') {
                try {
                    const voices = await service.voices(data.provider);
                    ws.send(JSON.stringify({ type: 'ttsProviderVoices', provider: data.provider,
                        requestId: data.requestId, voices, success: true }));
                } catch (error) {
                    ws.send(JSON.stringify({ type: 'ttsProviderVoices', provider: data.provider,
                        requestId: data.requestId, success: false, message: error.message }));
                }
                return true;
            }
            try {
                let patch = data.config;
                if (data.type === 'setChatTtsSelection') {
                    // 显示端只编辑与声纹页相同的AI默认及对应方式音色，不能借此改凭据或其它业务。
                    const allowed = new Set(['type', 'provider', 'voice', 'speed', 'volume', 'requestId']);
                    if (Object.keys(data).some(key => !allowed.has(key)) || !PROVIDERS.includes(data.provider)) throw new Error('TTS快选参数不合法');
                    const current = config.getPublicTtsProviderSettings();
                    if (Object.hasOwn(data, 'volume')) {
                        // 总音量是根级共享偏好；迟到的滑条消息不得重选语音方式或音色。
                        if (Object.hasOwn(data, 'speed') || Object.hasOwn(data, 'voice')) throw new Error('总音量请单独调整');
                        if (!Number.isInteger(data.volume) || data.volume < 0 || data.volume > 100) throw new Error('总音量必须是 0 至 100 的整数');
                        patch = { defaultVolume: data.volume };
                    } else if (Object.hasOwn(data, 'speed')) {
                        // 快捷调速只写该方式偏好，不让另一端晚到的滑条操作重选AI默认或音色。
                        if (typeof data.speed !== 'number' || !Number.isFinite(data.speed)) throw new Error('语速必须是有限数值');
                        if (Object.hasOwn(data, 'voice')) throw new Error('语速与音色请分别调整');
                        if (!supportsNativeSpeed(data.provider, current.providers[data.provider]?.model)) throw new Error('当前语音方式或模型不支持调速');
                        patch = { providers: { [data.provider]: { defaultSpeed: normalizeNumber(data.speed, 0, -10, 10) } } };
                    } else {
                        const voice = data.provider === 'system' ? null : data.voice ?? current.providers[data.provider]?.defaultVoice;
                        patch = { aiReplyDefault: { provider: data.provider, voice },
                            ...(data.provider === 'system' ? {} : { providers: { [data.provider]: { defaultVoice: voice } } }) };
                    }
                }
                config.setTtsProviderSettings(patch);
                onConfigChanged();
                broadcast(message({ requestId: data.requestId, success: true }));
            } catch (error) {
                ws.send(JSON.stringify(message({ requestId: data.requestId, success: false, message: error.message })));
            }
            return true;
        }
    };
}

module.exports = { createTtsProviderWs };
