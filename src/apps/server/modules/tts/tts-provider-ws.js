'use strict';
const { PROVIDERS } = require('./tts-provider-policy');
const { supportsNativeSpeed, normalizeNumber } = require('./tts-provider-settings');

// 与AASC控制端handler共用同一权威配置流程，禁止额外HTTP配置接口。
function createTtsProviderWs({ config, service, isControl, isDisplay = () => false, broadcast }) {
    const message = extra => ({ type: 'ttsProviderConfig', config: config.getPublicTtsProviderSettings(), ...extra });
    return {
        snapshot: message,
        async handle(ws, data) {
            if (!['setTtsProviderConfig', 'getTtsProviderVoices', 'setChatTtsSelection', 'getChatTtsConfig'].includes(data.type)) return false;
            const control = isControl(ws);
            if (!control && (!isDisplay(ws) || data.type === 'setTtsProviderConfig')) return true;
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
                    const allowed = new Set(['type', 'provider', 'voice', 'speed', 'requestId']);
                    if (Object.keys(data).some(key => !allowed.has(key)) || !PROVIDERS.includes(data.provider)) throw new Error('TTS快选参数不合法');
                    const current = config.getPublicTtsProviderSettings();
                    if (Object.hasOwn(data, 'speed')) {
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
                broadcast(message({ requestId: data.requestId, success: true }));
            } catch (error) {
                ws.send(JSON.stringify(message({ requestId: data.requestId, success: false, message: error.message })));
            }
            return true;
        }
    };
}

module.exports = { createTtsProviderWs };
