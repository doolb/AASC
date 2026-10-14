'use strict';

// 累计迁移必须明确声明兼容0/1/2；已有版本2不重置用户后来调整的显示偏好。
module.exports = async ({ services, readVersion, assert, log }) => {
    const { dataVersion } = readVersion();
    const steps = {
        0: async () => {
            await services.config.set('voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint', true);
            assert(services.config.get('voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint') === true, '声纹开关未保存');
            await steps[1]();
        },
        1: async () => {
            const saved = await services.config.updateDisplayStateById('offline-display', null, { showStatusBar: false });
            assert(saved?.showStatusBar === false && saved.displayId === 'offline-display', '状态栏配置未保存');
        },
        2: async () => {}
    };
    assert(Object.hasOwn(steps, dataVersion), '累计迁移不支持当前数据版本');
    await steps[dataVersion]();
    log('累计配置迁移已完成', { status: 'applied' });
};
