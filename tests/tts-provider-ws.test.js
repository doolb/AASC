'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSettings, redactSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { createTtsProviderWs } = require('../src/apps/server/modules/tts/tts-provider-ws');

test('控制端保存上游额度后刷新队列并广播，非法输入不保存，显示端无权改额度', async () => {
    // 对应.src/framework/tts-provider-configuration.md：运行时通知必须发生在业务保存成功后。
    let settings = normalizeSettings(), refreshes = 0;
    const replies = [], broadcasts = [];
    const control = { send: value => replies.push(JSON.parse(value)) };
    const display = { send: value => replies.push(JSON.parse(value)) };
    const handler = createTtsProviderWs({ config: {
        getPublicTtsProviderSettings: () => redactSettings(settings),
        setTtsProviderSettings: patch => { settings = normalizeSettings(patch, settings); }
    }, service: {}, isControl: ws => ws === control, isDisplay: ws => ws === display,
    broadcast: message => broadcasts.push(message), onConfigChanged: () => { refreshes++; } });
    await handler.handle(control, { type: 'setTtsProviderConfig', requestId: 'limit', config: { upstreamConcurrency: { 'doubao-chat': '5' } } });
    assert.equal(refreshes, 1);
    assert.equal(broadcasts.at(-1).config.upstreamConcurrency['doubao-chat'], 5);
    assert.equal(broadcasts.at(-1).success, true);
    await handler.handle(control, { type: 'setTtsProviderConfig', config: { upstreamConcurrency: { 'doubao-chat': 0 } } });
    assert.equal(replies.at(-1).success, false); assert.equal(refreshes, 1);
    assert.equal(replies.at(-1).config.upstreamConcurrency['doubao-chat'], 5);
    await handler.handle(display, { type: 'setChatTtsSelection', provider: 'doubao-chat', upstreamConcurrency: { 'doubao-chat': 8 } });
    assert.equal(replies.at(-1).success, false);
    await handler.handle(display, { type: 'setTtsProviderConfig', config: { upstreamConcurrency: { 'doubao-chat': 8 } } });
    assert.equal(refreshes, 1);
    assert.equal(handler.snapshot().config.upstreamConcurrency['doubao-chat'], 5);
});

test('显示端快选复用共享配置、各方式保留音色且只允许窄权限参数', async () => {
    const { listDoubaoVoices } = require('../src/apps/server/modules/chat2api/chat2api-doubao-voices');
    const male = listDoubaoVoices().find(v => v.gender === 'male').id;
    let settings = normalizeSettings();
    const replies = [], broadcasts = [];
    const display = { send: raw => replies.push(JSON.parse(raw)) };
    let fail = false;
    const handler = createTtsProviderWs({ config: {
        getPublicTtsProviderSettings: () => redactSettings(settings),
        setTtsProviderSettings: patch => { if (fail) throw Error('保存失败'); settings = normalizeSettings(patch, settings); }
    }, service: { voices: async () => listDoubaoVoices() }, isControl: () => false,
    isDisplay: ws => ws === display, broadcast: message => broadcasts.push(message) });
    await handler.handle(display, { type: 'setChatTtsSelection', provider: 'doubao-chat', voice: male, requestId: 'male' });
    assert.equal(settings.aiReplyDefault.voice, male);
    assert.equal(settings.providers['doubao-chat'].defaultVoice, male);
    await handler.handle(display, { type: 'setChatTtsSelection', provider: 'qwen-api', voice: 'Cherry' });
    assert.equal(settings.providers['doubao-chat'].defaultVoice, male);
    await handler.handle(display, { type: 'setChatTtsSelection', provider: 'doubao-chat' });
    assert.equal(settings.aiReplyDefault.voice, male);
    assert.equal(broadcasts.length, 3);
    await handler.handle(display, { type: 'setChatTtsSelection', provider: 'doubao-chat', voice: male, enabled: true });
    assert.equal(replies.at(-1).success, false);
    await handler.handle(display, { type: 'setTtsProviderConfig', config: { providers: { 'doubao-chat': { enabled: true } } } });
    assert.equal(settings.providers['doubao-chat'].enabled, true);
    await handler.handle({}, { type: 'setChatTtsSelection', provider: 'system' });
    assert.equal(settings.aiReplyDefault.provider, 'doubao-chat');
    fail = true;
    await handler.handle(display, { type: 'setChatTtsSelection', provider: 'system', requestId: 'failed' });
    assert.equal(replies.at(-1).config.aiReplyDefault.voice, male);
    await handler.handle(display, { type: 'getTtsProviderVoices', provider: 'doubao-chat' });
    assert.equal(replies.at(-1).voices.length, 94);
});

test('控制端保存广播权威脱敏值，失败回旧值；声音查询和未授权消息隔离', async () => {
    let settings = normalizeSettings();
    let fail = false;
    let queries = 0;
    const replies = [];
    const broadcasts = [];
    const control = { send: raw => replies.push(JSON.parse(raw)) };
    const handler = createTtsProviderWs({ config: {
        getPublicTtsProviderSettings: () => redactSettings(settings),
        setTtsProviderSettings: patch => { if (fail) throw new Error('保存失败'); settings = normalizeSettings(patch, settings); }
    }, service: { voices: async () => { queries += 1; return [{ id: 'voice' }]; } },
    isControl: ws => ws === control, broadcast: value => broadcasts.push(value) });
    await handler.handle({}, { type: 'setTtsProviderConfig', config: {} });
    assert.equal(broadcasts.length, 0);
    await handler.handle(control, { type: 'setTtsProviderConfig', requestId: 'a', config: { providers: { 'qwen-api': { credential: 'private-key', defaultSpeed: 100 } } } });
    assert.equal(broadcasts[0].requestId, 'a');
    assert.equal(broadcasts[0].config.providers['qwen-api'].defaultSpeed, 10);
    assert.ok(!Object.hasOwn(broadcasts[0].config, 'defaultSpeed'));
    assert.ok(!Object.hasOwn(broadcasts[0].config.providers['doubao-chat'], 'defaultSpeed'));
    assert.ok(!JSON.stringify(broadcasts).includes('private-key'));
    assert.deepEqual(handler.snapshot().config, broadcasts[0].config);
    fail = true;
    await handler.handle(control, { type: 'setTtsProviderConfig', requestId: 'b', config: { providers: { 'qwen-api': { defaultSpeed: 2 } } } });
    assert.equal(replies[0].success, false);
    assert.equal(replies[0].config.providers['qwen-api'].defaultSpeed, 10);
    assert.equal(broadcasts.length, 1);
    await handler.handle(control, { type: 'getTtsProviderVoices', provider: 'qwen-api', requestId: 'c' });
    assert.equal(replies[1].requestId, 'c');
    assert.equal(replies[1].voices[0].id, 'voice');
    await handler.handle({}, { type: 'getTtsProviderVoices' });
    assert.equal(queries, 1);
    assert.equal(await handler.handle(control, { type: 'unrelated' }), false);
});

test('TTS不再处理或调用账号候选查询', async () => {
    let accessed = false;
    const handler = createTtsProviderWs({ config: {}, isControl: () => true, accounts: { list: async () => { accessed = true; } } });
    assert.equal(await handler.handle({}, { type: 'getTtsProviderAccounts' }), false);
    assert.equal(accessed, false);
});

test('错误网页模型保存失败回传原权威值，同固定值兼容保存广播', async () => {
    let settings = normalizeSettings();
    const replies = [];
    const broadcasts = [];
    const control = { send: raw => replies.push(JSON.parse(raw)) };
    const handler = createTtsProviderWs({ config: {
        getPublicTtsProviderSettings: () => redactSettings(settings),
        setTtsProviderSettings: patch => { settings = normalizeSettings(patch, settings); }
    }, isControl: ws => ws === control, broadcast: message => broadcasts.push(message) });
    await handler.handle(control, { type: 'setTtsProviderConfig', requestId: 'bad-model', config: { providers: { 'qwen-chat': { model: 'qwen3-tts-flash' } } } });
    assert.equal(replies[0].success, false);
    assert.equal(replies[0].requestId, 'bad-model');
    assert.match(replies[0].message, /固定为 QUARK_VOICE/u);
    assert.equal(replies[0].config.providers['qwen-chat'].model, 'QUARK_VOICE');
    assert.deepEqual(broadcasts, []);
    await handler.handle(control, { type: 'setTtsProviderConfig', config: { providers: { 'qwen-chat': { model: 'QUARK_VOICE' } } } });
    assert.equal(broadcasts[0].config.providers['qwen-chat'].model, 'QUARK_VOICE');
});

test('真实显示入口补入displayId后仍可快选，未知业务字段和显示端完整配置继续拒绝', async () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const WSViewBindServer = require('../src/core/viewbind/WSViewBindServer');
    const { registerTextMediaDisplayHandlers } = require('../src/apps/server/modules/media/text-media-ws-integration');
    const source = fs.readFileSync(require.resolve('../src/apps/server/boot/server-app'), 'utf8');
    const start = source.indexOf('function handleDisplayMessageFallback(');
    const end = source.indexOf('    if (displayVoiceListeningConfig.handle', start);
    assert.ok(start > 0 && end > start);
    let settings = normalizeSettings();
    const replies = [], broadcasts = [];
    const display = { send: raw => replies.push(JSON.parse(raw)) };
    const ttsProviderWs = createTtsProviderWs({
        config: { getPublicTtsProviderSettings: () => redactSettings(settings),
            setTtsProviderSettings: patch => { settings = normalizeSettings(patch, settings); } },
        service: { voices: async () => [] }, isControl: () => false,
        isDisplay: ws => ws === display, broadcast: message => broadcasts.push(message)
    });
    // 执行生产转交分支及真实ViewBind注册，覆盖原组件单测缺少的传输字段。
    const fallback = vm.runInNewContext('(' + source.slice(start, end) + '\n})', { ttsProviderWs });
    const server = new WSViewBindServer();
    registerTextMediaDisplayHandlers({ wsServer: server,
        displayTypes: ['setChatTtsSelection', 'getChatTtsConfig', 'getTtsProviderVoices'],
        handleDisplayMessage: fallback }, {});
    const ingressSource = source.match(/const data = JSON\.parse\(message\);\s*data\.displayId = displayId;/u)?.[0];
    assert.ok(ingressSource, '使用生产显示端入口的身份覆盖代码');
    const ingress = vm.runInNewContext('(function(message, displayId) {' + ingressSource + ' return data; })');
    const send = async data => {
        const message = ingress(JSON.stringify(data), 'registered-display');
        await server.handleDisplayMessage('registered-display', message, display);
    };
    await send({ type: 'setChatTtsSelection', provider: 'doubao-chat', requestId: 'provider', displayId: 'spoof' });
    assert.equal(broadcasts.at(-1).success, true);
    assert.equal(settings.aiReplyDefault.provider, 'doubao-chat');
    const { listDoubaoVoices } = require('../src/apps/server/modules/chat2api/chat2api-doubao-voices');
    const voice = listDoubaoVoices()[1].id;
    await send({ type: 'setChatTtsSelection', provider: 'doubao-chat', voice, requestId: 'voice' });
    assert.equal(settings.aiReplyDefault.voice, voice);
    const prior = JSON.stringify(settings);
    for (const field of ['enabled', 'credential', 'unknownField']) {
        await send({ type: 'setChatTtsSelection', provider: 'system', [field]: true });
        assert.equal(replies.at(-1).success, false);
        assert.equal(JSON.stringify(settings), prior);
    }
    await ttsProviderWs.handle(display, { type: 'setTtsProviderConfig', config: { aiReplyDefault: { provider: 'system' } } });
    assert.equal(JSON.stringify(settings), prior);
    await send({ type: 'getChatTtsConfig' });
    assert.equal(replies.at(-1).config.aiReplyDefault.voice, voice);
});

test('快捷语速只写目标方式偏好，归一化范围并拒绝不支持或混合写入', async () => {
    let settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat', voice: null } });
    const replies = [], broadcasts = [];
    const display = { send: raw => replies.push(JSON.parse(raw)) };
    const handler = createTtsProviderWs({ config: {
        getPublicTtsProviderSettings: () => redactSettings(settings),
        setTtsProviderSettings: patch => { settings = normalizeSettings(patch, settings); }
    }, service: {}, isControl: () => false, isDisplay: ws => ws === display,
    broadcast: message => broadcasts.push(message) });
    const selection = { ...settings.aiReplyDefault };
    const nativeSpeed = settings.providers.system.defaultSpeed;
    for (const [input, expected] of [[3, 3], [100, 10], [-100, -10], [0, 0]]) {
        await handler.handle(display, { type: 'setChatTtsSelection', provider: 'qwen-chat', speed: input, requestId: 'speed' });
        assert.equal(settings.providers['qwen-chat'].defaultSpeed, expected);
        assert.deepEqual(settings.aiReplyDefault, selection);
        assert.equal(settings.providers.system.defaultSpeed, nativeSpeed);
        assert.equal(broadcasts.at(-1).requestId, 'speed');
    }
    const prior = JSON.stringify(settings);
    for (const request of [
        { provider: 'doubao-chat', speed: 2 },
        ...[null, '2', NaN, Infinity, {}].map(speed => ({ provider: 'qwen-chat', speed })),
        { provider: 'qwen-chat', speed: 2, voice: 'voice' },
        { provider: 'qwen-chat', speed: 2, enabled: true }
    ]) {
        await handler.handle(display, { type: 'setChatTtsSelection', ...request });
        assert.equal(replies.at(-1).success, false);
        assert.equal(JSON.stringify(settings), prior);
    }
    // 另一端切到system后，晚到的千问语速操作只改千问偏好，不能把全局方式切回去。
    await handler.handle(display, { type: 'setChatTtsSelection', provider: 'system' });
    await handler.handle(display, { type: 'setChatTtsSelection', provider: 'qwen-chat', speed: 4 });
    assert.equal(settings.aiReplyDefault.provider, 'system');
    assert.equal(settings.providers['qwen-chat'].defaultSpeed, 4);
    settings = normalizeSettings({ providers: { 'qwen-api': { model: 'qwen-audio-3.1-tts-flash' } } }, settings);
    await handler.handle(display, { type: 'setChatTtsSelection', provider: 'qwen-api', speed: 2 });
    assert.equal(broadcasts.at(-1).success, true);
    assert.equal(settings.providers['qwen-api'].defaultSpeed, 2);
});

test('快捷总音量只写共享默认值，拒绝非法值与混合写入', async () => {
    let settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat' } });
    const replies = [], broadcasts = [];
    const display = { send: raw => replies.push(JSON.parse(raw)) };
    const handler = createTtsProviderWs({ config: {
        getPublicTtsProviderSettings: () => redactSettings(settings),
        setTtsProviderSettings: patch => { settings = normalizeSettings(patch, settings); }
    }, service: {}, isControl: () => false, isDisplay: ws => ws === display,
    broadcast: message => broadcasts.push(message) });
    const selection = JSON.stringify(settings.aiReplyDefault);
    const speed = settings.providers['qwen-chat'].defaultSpeed;
    for (const volume of [0, 42, 100]) {
        await handler.handle(display, { type: 'setChatTtsSelection', provider: 'system', volume, requestId: `volume-${volume}` });
        assert.equal(settings.defaultVolume, volume);
        assert.equal(broadcasts.at(-1).config.defaultVolume, volume);
        assert.equal(broadcasts.at(-1).requestId, `volume-${volume}`);
        assert.equal(JSON.stringify(settings.aiReplyDefault), selection);
        assert.equal(settings.providers['qwen-chat'].defaultSpeed, speed);
    }
    const prior = JSON.stringify(settings);
    for (const request of [
        ...[-1, 101, 1.5, NaN, Infinity, null, '20'].map(volume => ({ volume })),
        { volume: 20, voice: 'x' }, { volume: 20, speed: 2 }, { volume: 20, credential: 'x' }
    ]) {
        await handler.handle(display, { type: 'setChatTtsSelection', provider: 'system', ...request });
        assert.equal(replies.at(-1).success, false);
        assert.equal(JSON.stringify(settings), prior);
    }
    assert.equal(broadcasts.length, 3);
});

test('快捷语速保存后新批次使用新值，已开始的真实生成批次保持快照', async () => {
    const { createTtsProviderService } = require('../src/apps/server/modules/tts/tts-provider-service');
    const { wrapPcm } = require('../src/apps/server/modules/tts/tts-provider-http');
    let settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat', voice: null } });
    const generated = [];
    const service = createTtsProviderService({ getSettings: () => settings, storeAudio: () => 'fixture.wav',
        registry: { 'qwen-chat': { async generate(request) { generated.push(request.speed); return wrapPcm(Buffer.from([1, 0, 2, 0])); } } } });
    const handler = createTtsProviderWs({ config: {
        getPublicTtsProviderSettings: () => redactSettings(settings),
        setTtsProviderSettings: patch => { settings = normalizeSettings(patch, settings); }
    }, service, isControl: () => true, broadcast() {} });
    const prior = service.snapshot({ businessType: 'ai_reply' });
    await handler.handle({}, { type: 'setChatTtsSelection', provider: 'qwen-chat', speed: 3 });
    await service.generate({ businessType: 'ai_reply', text: '旧批次' }, { configuration: prior.ttsConfiguration });
    await service.generate({ businessType: 'ai_reply', text: '新批次' });
    assert.deepEqual(generated, [0, 3]);
});
