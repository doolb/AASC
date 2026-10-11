'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { createQwenChatProvider, createQwenSigner, parseCookies } = require('../src/apps/server/modules/tts/qwen-chat-tts');
const { normalizeSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { createTtsProviderService } = require('../src/apps/server/modules/tts/tts-provider-service');
const cache = require('../src/external/tts/tts-audio-cache');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createChat2ApiDataStore } = require('../src/apps/server/modules/chat2api/chat2api-data-store');
const { createTtsChat2ApiAccounts } = require('../src/apps/server/modules/tts/tts-chat2api-accounts');

async function accountFixture(t, ticket) {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-tts-qwen-account-'));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    const dataStore = createChat2ApiDataStore({ rootDir });
    await dataStore.saveAccount({ accountId: 'qwen-test', providerId: 'qwen', credentials: { ticket } });
    return { dataStore, ...createTtsChat2ApiAccounts({ dataStore }) };
}

async function socketFixture(t, onPacket) {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise(resolve => server.on('listening', resolve));
    server.on('connection', (socket, request) => socket.on('message', raw => onPacket(socket, JSON.parse(String(raw)), request)));
    t.after(() => { for (const socket of server.clients) socket.terminate(); server.close(); });
    return `ws://127.0.0.1:${server.address().port}/tts`;
}

test('国内千问WebSocket真实文本/结束包、同reqid、分片去重、最后包音频后完成', async t => {
    const packets = [];
    let handshake;
    const pcm = Buffer.from([1, 0, 2, 0]);
    const url = await socketFixture(t, (socket, packet, request) => {
        packets.push(packet);
        handshake = request.headers;
        if (packet.status !== 2) return;
        const chunk = { code: 2000000, data: { status: 1, res_ced: 0, audio: pcm.toString('base64') } };
        socket.send(JSON.stringify(chunk));
        socket.send(JSON.stringify(chunk));
        socket.send(JSON.stringify({ code: 2000000, data: { status: 2, res_ced: 1, audio: pcm.toString('base64') } }));
    });
    let signing;
    const accounts = await accountFixture(t, 'ticket-value');
    const adapter = createQwenChatProvider({ resolveCredential: accounts.resolveCredential,
        sign: async options => { signing = options; return { url, userAgent: 'test-browser' }; } });
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat' }, providers: { 'qwen-chat': { enabled: true, chat2apiAccountId: 'qwen-test', defaultSpeed: 10 } } });
    const service = createTtsProviderService({ getSettings: () => settings, registry: { 'qwen-chat': adapter } });
    const reference = await service.generate({ text: '国内网页朗读', businessType: 'agent_reply' });
    assert.deepEqual(packets.map(packet => packet.status), [1, 2]);
    assert.equal(packets[0].reqid, signing.reqid);
    assert.equal(packets[1].reqid, signing.reqid);
    assert.equal(packets[0].text, '国内网页朗读');
    assert.equal(packets[0].model, 'QUARK_VOICE');
    assert.equal(packets[0].speed, 2);
    assert.equal(packets[0].sample_rate, 24000);
    assert.equal(packets[1].text, '');
    assert.equal(handshake.origin, 'https://www.qianwen.com');
    assert.equal(handshake.cookie, 'tongyi_sso_ticket=ticket-value');
    assert.equal(handshake['user-agent'], 'test-browser');
    assert.deepEqual(cache.getAudio(reference).buffer.subarray(44), Buffer.concat([pcm, pcm]));
    await accounts.dataStore.updateAccount('qwen-test', { credentials: { ticket: 'updated-ticket' } });
    await service.generate({ text: '更新账号后朗读', businessType: 'ai_reply' });
    assert.equal(handshake.cookie, 'tongyi_sso_ticket=updated-ticket');
    assert.equal(signing.credential, handshake.cookie);
    assert.ok(!JSON.stringify(settings).includes('ticket-value'));
});

test('国内千问错误、缺完成、坏JSON、空音频、超时均无缓存或静默回退', async t => {
    let mode = 'auth';
    const url = await socketFixture(t, (socket, packet) => {
        if (packet.status !== 2) return;
        const actions = {
            auth: () => socket.send(JSON.stringify({ code: 401, message: 'private-cookie' })),
            close: () => socket.close(),
            invalid: () => socket.send('not-json'),
            empty: () => socket.send(JSON.stringify({ data: { status: 2 } })),
            timeout: () => {}
        };
        actions[mode]();
    });
    const accounts = await accountFixture(t, 'private-cookie');
    const adapter = createQwenChatProvider({ resolveCredential: accounts.resolveCredential, sign: async () => url });
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat' }, providers: { 'qwen-chat': { enabled: true, chat2apiAccountId: 'qwen-test' } } });
    let stores = 0;
    const service = createTtsProviderService({ getSettings: () => settings, registry: { 'qwen-chat': adapter }, timeoutMs: 50, storeAudio: () => { stores += 1; } });
    for (const value of ['auth', 'close', 'invalid', 'empty', 'timeout']) {
        mode = value;
        await assert.rejects(service.generate({ text: '测试', businessType: 'ai_reply' }), error => {
            assert.equal(error.provider, 'qwen-chat');
            assert.ok(!error.message.includes('private-cookie'));
            return true;
        });
    }
    assert.equal(stores, 0);
});

test('官方网页签名使用隔离Cookie并关闭浏览器；错误不回显私有URL', async () => {
    let closed = 0;
    let cookies;
    let visited;
    let args;
    const browser = {
        setCookie: async (...values) => { cookies = values; },
        newPage: async () => ({ goto: async value => { visited = value; }, waitForFunction: async () => {},
            evaluate: async (fn, values) => { args = values; return { url: 'wss://speech-tts.qianwen.com/api/v3/tts?signature=secret', userAgent: 'Chrome-test' }; } }),
        close: async () => { closed += 1; }
    };
    const sign = createQwenSigner({ launch: async () => browser });
    const result = await sign({ credential: 'tongyi_sso_ticket=private-value; other=ok', reqid: 'request-a', timeoutMs: 1000 });
    assert.equal(result.userAgent, 'Chrome-test');
    assert.equal(cookies[0].domain, '.qianwen.com');
    assert.equal(cookies[0].name, 'tongyi_sso_ticket');
    assert.equal(visited, 'https://www.qianwen.com/');
    assert.equal(args.reqid, 'request-a');
    assert.equal(closed, 1);
    browser.newPage = async () => { throw new Error('https://secret-url/?ticket=private-value'); };
    await assert.rejects(sign({ credential: 'ticket', reqid: 'b', timeoutMs: 1000 }), error => !error.message.includes('private-value'));
    assert.equal(closed, 2);
    assert.throws(() => parseCookies('Cookie: x=hello\r\nsecret'), /格式/u);
});

test('签名超时关闭资源、迟到结果忽略；模型音频阶段只使用剩余总时限', async () => {
    let closed = 0;
    const browser = { setCookie: async () => {}, newPage: async () => ({ goto: async () => new Promise(() => {}) }), close: async () => { closed += 1; } };
    const sign = createQwenSigner({ launch: async () => browser });
    await assert.rejects(sign({ credential: 'ticket', reqid: 'a', timeoutMs: 20 }), /超时/u);
    assert.equal(closed, 1);
    const provider = createQwenChatProvider({ resolveCredential: async () => 'ticket',
        sign: async () => { await new Promise(resolve => setTimeout(resolve, 25)); return 'ws://127.0.0.1/tts'; } });
    await assert.rejects(provider.generate({ text: 'test', timeoutMs: 10 }, { enabled: true, chat2apiAccountId: 'qwen-test' }), /超时/u);
});

test('手动凭证不能绕过账号选择，账号错误不会调用签名或合成', async () => {
    let signs = 0;
    const provider = createQwenChatProvider({ resolveCredential: async () => { throw new Error('账号已停用'); },
        sign: async () => { signs += 1; } });
    await assert.rejects(provider.generate({ timeoutMs: 100 }, { enabled: true, credential: 'legacy-ticket' }), /请选择 Chat2API/u);
    await assert.rejects(provider.generate({ timeoutMs: 100 }, { enabled: true, chat2apiAccountId: 'disabled', credential: 'legacy-ticket' }), /账号已停用/u);
    assert.equal(signs, 0);
});

test('账号读取计入总超时，迟到读取不能继续签名', async () => {
    let signs = 0;
    let complete;
    const provider = createQwenChatProvider({ resolveCredential: () => new Promise(resolve => { complete = resolve; }),
        sign: async () => { signs += 1; } });
    await assert.rejects(provider.generate({ timeoutMs: 20 }, { enabled: true, chat2apiAccountId: 'a' }), /账号读取超时/u);
    complete('late-ticket');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(signs, 0);
});
