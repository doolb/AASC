'use strict';

// 对应.src/framework/qwen-api-data-repair.md：累计补齐历史阶段，再迁移明确的旧Qwen默认配置。
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
        2: async () => {},
        3: async () => {}
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
    for (const rule of dataVersion < 3 ? defaults : []) {
        if (!current.some(item => matches(rule.model, item.model))) {
            await services.chat2api.saveModelMapping(rule);
            current.push(rule);
        }
    }
    const actual = await services.chat2api.listModelMappings({ includeDefaults: false });
    assert(dataVersion >= 3 || defaults.every(rule => actual.some(item => matches(rule.model, item.model))), '模型默认映射补齐失败');
    // 目录随签名脚本固定，不访问网络或运行时模块；只认可官方3.1的精确大小写ID。
    const validVoices = [
        "longanhuan_v3.1",
        "longanlingxin_v3.1",
        "longanfengyue_v3.1",
        "xunanchuan_v3.1",
        "yuxiaoyun_v3.1",
        "qiaoxiaojiao_v3.1",
        "xiaxiaochen_v3.1",
        "anmingyuan_v3.1",
        "wenhuaiqing_v3.1",
        "anxiaolan_v3.1",
        "xieshurou_v3.1",
        "baiqinglan_v3.1",
        "xuyuyuan_v3.1",
        "anruorou_v3.1",
        "wenhuaizhi_v3.1",
        "xiaoxingzhi_v3.1",
        "guyunshu_v3.1",
        "huozhuoshi_v3.1",
        "yeqinghe_v3.1",
        "yunhuanhuan_v3.1",
        "xuxiaoqiao_v3.1",
        "baianran_v3.1",
        "xuyanchu_v3.1",
        "yezhiqing_v3.1",
        "andi_v3.1",
        "anyuqing_v3.1",
        "Emily_v3.1",
        "Luna_v3.1",
        "Eric_v3.1",
        "Luca_v3.1",
        "Abby_v3.1",
        "Annie_v3.1",
        "Ava_v3.1",
        "Beth_v3.1",
        "Betty_v3.1",
        "Cally_v3.1",
        "Cindy_v3.1",
        "Donna_v3.1",
        "Andy_v3.1",
        "Brian_v3.1",
        "David_v3.1",
        "longanyuanfei_v3.1",
        "longjielidou_v3.1",
        "longanlingxi_v3.1",
        "longhuohuo_v3.1",
        "longyingtao_v3.1",
        "longanya_v3.1",
        "longwan_v3.1",
        "longxing_v3.1",
        "longhua_v3.1",
        "longhan_v3.1",
        "longanzhi_v3.1",
        "longzhe_v3.1",
        "longanyang_v3.1",
        "libai_v3.1",
        "longling_v3.1",
        "longniuniu_v3.1",
        "longshanshan_v3.1",
        "longpaopao_v3.1",
        "loongstella_v3.1",
        "longyuan_v3.1",
        "longmiao_v3.1",
        "longsanshu_v3.1",
        "longanli_v3.1",
        "longanwen_v3.1",
        "longanlang_v3.1",
        "longxiaoxia_v3.1",
        "longanchong_v3.1"
];
    const oldModel = 'qwen3-tts-flash';
    const targetModel = 'qwen-audio-3.1-tts-flash';
    const targetVoice = 'qiaoxiaojiao_v3.1';
    const legacyVoices = ['Cherry', 'Serena', 'Ethan', 'Chelsie'];
    const currentSettings = await services.config.getPublicTtsProviderSettings();
    const qwen = currentSettings.providers['qwen-api'];
    const businesses = ['aiReplyDefault', 'textMedia', 'systemBroadcast'];
    const selections = businesses.filter(key => currentSettings[key]?.provider === 'qwen-api');
    const skip = reason => log('Qwen配置保留', { status: reason });
    if (![oldModel, targetModel].includes(qwen.model)) {
        skip('skipped-custom-model');
        return;
    }
    // 自定义映射可改变实际模型或合成参数；无账号/Provider私有数据权限时保守保留。
    if (actual.some(item => matches(oldModel, item.model) || matches(targetModel, item.model))) {
        skip('skipped-custom-mapping');
        return;
    }
    const knownVoice = voice => !voice || legacyVoices.includes(voice) || validVoices.includes(voice);
    if (!knownVoice(qwen.defaultVoice) || selections.some(key => !knownVoice(currentSettings[key].voice))) {
        skip('skipped-custom-voice');
        return;
    }
    const providerPatch = {};
    if (qwen.model === oldModel) providerPatch.model = targetModel;
    if (!qwen.defaultVoice || legacyVoices.includes(qwen.defaultVoice)) providerPatch.defaultVoice = targetVoice;
    const patch = {};
    if (Object.keys(providerPatch).length) patch.providers = { 'qwen-api': providerPatch };
    for (const key of selections) {
        if (legacyVoices.includes(currentSettings[key].voice)) patch[key] = { provider: 'qwen-api', voice: targetVoice };
    }
    if (!Object.keys(patch).length) {
        skip('already-current');
        return;
    }
    // 只提交必要字段，凭证、其他Provider、独立语速和共享音量继续由现有业务服务保留。
    await services.config.setTtsProviderSettings(patch);
    const saved = await services.config.getPublicTtsProviderSettings();
    assert(saved.providers['qwen-api'].model === targetModel, 'Qwen模型迁移未保存');
    assert(saved.providers['qwen-api'].defaultVoice === (providerPatch.defaultVoice || qwen.defaultVoice), 'Qwen默认音色迁移未保存');
    for (const key of selections) {
        assert(saved[key].voice === (patch[key]?.voice || currentSettings[key].voice), 'Qwen业务音色迁移未保存');
    }
    log('Qwen旧默认配置迁移完成', { status: 'updated' });

};
