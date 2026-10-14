'use strict';

module.exports = async ({ services, assert, log }) => {
    const configKey = 'voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint';
    const currentValue = await services.config.get(configKey, false);

    if (currentValue !== true) {
        await services.config.set(configKey, true);
    }

    const savedValue = await services.config.get(configKey, false);
    assert(savedValue === true, '声纹关闭时处理 TTS 期间语音的开关未保存');
    log('已启用声纹关闭时处理 TTS 期间语音', { status: 'enabled' });
};
