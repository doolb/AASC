'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSettings, redactSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { createTtsProviderWs } = require('../src/apps/server/modules/tts/tts-provider-ws');

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
