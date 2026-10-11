'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createChat2ApiDataStore } = require('./chat2api-data-store');
const { createChat2ApiSpeechService, normalizeSpeechRequest, getQwenCredential } = require('./chat2api-speech-service');
const { createChat2ApiRuntime } = require('./chat2api-runtime');
const { wrapPcm } = require('../../../../external/tts/tts-wav');
const audio = wrapPcm(Buffer.from([1, 0, 2, 0]));

async function fixture(t, options = {}) {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat2api-speech-'));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    const dataStore = createChat2ApiDataStore({ rootDir });
    const calls = [];
    const service = createChat2ApiSpeechService({ dataStore, qwenAdapter: { generate: async (...args) => { calls.push(args); return audio; } }, ...options });
    return { rootDir, dataStore, calls, service };
}

test('Chat2API自动调度国内有效账号，排除国际/停用/限额/无凭证账号并读取更新值', async t => {
    const { dataStore, calls, service } = await fixture(t);
    for (const account of [
        { accountId: 'intl', providerId: 'qwen-ai', credentials: { token: 'intl-secret' } },
        { accountId: 'disabled', providerId: 'qwen', enabled: false, credentials: { ticket: 'disabled-secret' } },
        { accountId: 'empty', providerId: 'qwen' },
        { accountId: 'limited', providerId: 'qwen', dailyLimit: 1, todayUsed: 1, credentials: { ticket: 'limited-secret' } },
        { accountId: 'abnormal', providerId: 'qwen', status: 'error', credentials: { ticket: 'abnormal-secret' } },
        { accountId: 'one', providerId: 'qwen', cookie: 'tongyi_sso_ticket=old; extra=ok', credentials: { ticket: 'fresh-one' } },
        { accountId: 'two', providerId: 'qwen', credentials: { ticket: 'fresh-two' } }
    ]) await dataStore.saveAccount(account);
    const result = await service.generate({ input: '你好', model: 'qwen-chat', speed: 2, volume: 70 });
    assert.deepEqual(result, { audio, contentType: 'audio/wav' });
    assert.equal(calls[0][0].model, 'QUARK_VOICE');
    assert.equal(calls[0][0].speed, 2);
    assert.equal(calls[0][1], 'tongyi_sso_ticket=fresh-one; extra=ok');
    await service.generate({ input: '第二次' });
    assert.equal(calls[1][1], 'tongyi_sso_ticket=fresh-two');
    await dataStore.updateAccount('one', { credentials: { ticket: 'updated' } });
    await service.generate({ input: '第三次' });
    assert.equal(calls[2][1], 'tongyi_sso_ticket=updated; extra=ok');
    assert.ok(!JSON.stringify(result).includes('fresh-one'));
});

test('Chat2API使用已保存调度策略、无账号/Provider停用时明确报错', async t => {
    const { dataStore, calls, service } = await fixture(t);
    await assert.rejects(service.generate({ input: '没有账号' }), error => error.code === 'no_available_speech_account');
    await dataStore.saveAccount({ accountId: 'used', providerId: 'qwen', todayUsed: 100, credentials: { ticket: 'used' } });
    await dataStore.saveAccount({ accountId: 'less', providerId: 'qwen', todayUsed: 1, credentials: { ticket: 'less' } });
    await dataStore.writeCollection('config', { loadBalanceStrategy: 'fill-first' });
    await service.generate({ input: '按现有策略' });
    assert.equal(calls[0][1], 'tongyi_sso_ticket=less');
    await dataStore.writeCollection('providers', [{ id: 'qwen', enabled: false }]);
    await assert.rejects(service.generate({ input: '停用Provider' }), error => error.code === 'no_available_speech_account');
    assert.equal(calls.length, 1);
});

test('Chat2API账号凭证兼容字段、坏Cookie和ticket不回显且不修改输入', () => {
    assert.equal(getQwenCredential({ credentials: { tongyi_sso_ticket: 'value', cookies: { extra: 'ok' } } }), 'extra=ok; tongyi_sso_ticket=value');
    assert.equal(getQwenCredential({ cookie: 'Cookie: tongyi_sso_ticket=cookie-only' }), 'tongyi_sso_ticket=cookie-only');
    for (const value of [{}, { cookie: 'extra=ok' }, { credentials: { ticket: 'private;injection=1' } },
        { cookie: 'tongyi_sso_ticket=private\r\nvalue' }, { credentials: { ticket: 123 } }, { cookie: 'x'.repeat(16385) }]) {
        const before = JSON.stringify(value);
        assert.throws(() => getQwenCredential(value), error => error.code === 'speech_credentials_unavailable' && !error.message.includes('private'));
        assert.equal(JSON.stringify(value), before);
    }
});

test('语音请求校验在读取账号前执行，速度用倍率且仅接受完整WAV', async t => {
    for (const value of [{ input: '' }, { input: 'x', model: 'llm' }, { input: 'x', voice: false },
        { input: 'x', speed: -1 }, { input: 'x', speed: '1' }, { input: 'x', volume: 101 }, { input: 'x', response_format: 'mp3' }]) {
        assert.throws(() => normalizeSpeechRequest(value), error => error.code === 'invalid_speech_request');
    }
    const { dataStore, service } = await fixture(t, { qwenAdapter: { generate: async () => Buffer.from('partial-audio') } });
    await dataStore.saveAccount({ accountId: 'a', providerId: 'qwen', credentials: { ticket: 'private' } });
    await assert.rejects(service.generate({ input: '截断音频' }), error => error.code === 'speech_upstream_error' && !error.message.includes('private'));
});

test('上游错误脱敏，账号读取/上游生成总超时，迟到账号不会继续调用', async t => {
    const { dataStore, service } = await fixture(t, { qwenAdapter: { generate: async () => { throw new Error('private-cookie/signature'); } } });
    await dataStore.saveAccount({ accountId: 'a', providerId: 'qwen', credentials: { ticket: 'private' } });
    await assert.rejects(service.generate({ input: '上游失败' }), error => error.code === 'speech_upstream_error' && !error.message.includes('private'));
    let complete;
    let calls = 0;
    const delayed = createChat2ApiSpeechService({ dataStore, getConfig: () => new Promise(resolve => { complete = resolve; }),
        qwenAdapter: { generate: async () => { calls += 1; return audio; } } });
    await assert.rejects(delayed.generate({ input: '迟到账号' }, { timeoutMs: 20 }), error => error.code === 'speech_timeout');
    complete({});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0);
    const hanging = createChat2ApiSpeechService({ dataStore, qwenAdapter: { generate: () => new Promise(() => {}) } });
    await assert.rejects(hanging.generate({ input: '上游超时' }, { timeoutMs: 30 }), error => error.code === 'speech_timeout');
});

test('runtime语音与聊天共用账号层，HTTP speech沿用Bearer鉴权并返回二进制WAV', async t => {
    const { rootDir, dataStore } = await fixture(t);
    await dataStore.saveAccount({ accountId: 'a', providerId: 'qwen', credentials: { ticket: 'private-ticket' } });
    const calls = [];
    const runtime = createChat2ApiRuntime({ rootDir, dataStore, host: '127.0.0.1', port: 0,
        qwenSpeechAdapter: { generate: async (...args) => { calls.push(args); return audio; } } });
    await runtime.start();
    t.after(() => runtime.stop());
    const key = await dataStore.createApiKey({ name: 'speech-test' });
    const url = `http://127.0.0.1:${runtime.getStatus().address.port}/v1/audio/speech`;
    const denied = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'test' }) });
    assert.equal(denied.status, 401);
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key.value}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'hello', response_format: 'wav' }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio);
    assert.equal(calls[0][1], 'tongyi_sso_ticket=private-ticket');
    await dataStore.deleteAccount('a');
    const unavailable = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key.value}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'hello' }) });
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error.code, 'no_available_speech_account');
});

test('语音鉴权阶段码保留，固定提示不采用上游原文或伪造statusCode', async t => {
    const { dataStore } = await fixture(t);
    await dataStore.saveAccount({ accountId: 'a', providerId: 'qwen', credentials: { ticket: 'private' } });
    for (const [code, status] of [['speech_auth_calibration', 502], ['speech_auth_register', 502],
        ['speech_auth_refresh', 502], ['speech_auth_timeout', 504], ['speech_auth_capacity', 503]]) {
        const service = createChat2ApiSpeechService({ dataStore, qwenAdapter: { generate: async () => {
            throw Object.assign(new Error('private-cookie/signature-url'), { code, statusCode: 200 });
        } } });
        await assert.rejects(service.generate({ input: '失败阶段' }), e => e.code === code && e.statusCode === status && !e.message.includes('private'));
    }
});
