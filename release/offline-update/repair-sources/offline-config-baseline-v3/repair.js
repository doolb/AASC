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
    // 只补缺失映射；用户改过上游、账号或通配规则时保留原值。
    const defaults = [
    {
        "model": "deepseek-v4-flash-think",
        "actualModel": "deepseek-v4-flash",
        "providerId": "deepseek"
    },
    {
        "model": "deepseek-v4-flash-search",
        "actualModel": "deepseek-v4-flash",
        "providerId": "deepseek"
    },
    {
        "model": "deepseek-v4-flash-think-search",
        "actualModel": "deepseek-v4-flash",
        "providerId": "deepseek"
    },
    {
        "model": "deepseek-v4-pro-think",
        "actualModel": "deepseek-v4-pro",
        "providerId": "deepseek"
    },
    {
        "model": "deepseek-v4-pro-search",
        "actualModel": "deepseek-v4-pro",
        "providerId": "deepseek"
    },
    {
        "model": "deepseek-v4-pro-think-search",
        "actualModel": "deepseek-v4-pro",
        "providerId": "deepseek"
    },
    {
        "model": "Qwen3.6-Flash",
        "actualModel": "Qwen3.7",
        "providerId": "qwen"
    },
    {
        "model": "doubao",
        "actualModel": "doubao",
        "providerId": "doubaochat"
    },
    {
        "model": "doubao-think",
        "actualModel": "doubao-think",
        "providerId": "doubaochat"
    },
    {
        "model": "doubao-expert",
        "actualModel": "doubao-expert",
        "providerId": "doubaochat"
    }
];
    const matches = (model, pattern) => {
        const parts = String(pattern || '').toLowerCase().split('*');
        const input = model.toLowerCase();
        return parts.length === 1 ? input === parts[0] : parts.length === 2 && input.startsWith(parts[0]) && input.endsWith(parts[1]);
    };
    const current = await services.chat2api.listModelMappings({ includeDefaults: false });
    for (const rule of defaults) {
        if (!current.some(item => matches(rule.model, item.model))) {
            await services.chat2api.saveModelMapping(rule);
            current.push(rule);
        }
    }
    const actual = await services.chat2api.listModelMappings({ includeDefaults: false });
    assert(defaults.every(rule => actual.some(item => matches(rule.model, item.model))), '模型默认映射补齐失败');
    log('累计配置迁移已完成', { status: 'applied' });
};
