'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { createQwenChatProvider } = require('../src/apps/server/modules/tts/qwen-chat-tts');
const { createChat2ApiQwenSpeechAdapter, parseCookies } = require('../src/apps/server/modules/chat2api/chat2api-qwen-speech-adapter');
const { normalizeSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { createTtsProviderService } = require('../src/apps/server/modules/tts/tts-provider-service');
const cache = require('../src/external/tts/tts-audio-cache');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createChat2ApiDataStore } = require('../src/apps/server/modules/chat2api/chat2api-data-store');
const { createChat2ApiSpeechService } = require('../src/apps/server/modules/chat2api/chat2api-speech-service');
const { filterQwenChatSpeechText } = require('../src/apps/server/modules/tts/qwen-chat-text-filter');
const { wrapPcm } = require('../src/external/tts/tts-wav');

test('qwen-chat按字素簇移除emoji组合，普通数字、标点和正文空格保留', () => {
    for (const [input, expected] of [
        ['✨', ''], ['🐱💻⚡', ''], ['📶🐾', ''], ['❤️', ''], ['✨！？～\n❤️', ''],
        ['你好🐱，主人❤️！', '你好，主人！'], ['早上 👨‍👩‍👧‍👦 好', '早上  好'],
        ['👍🏽您好', '您好'], ['🇨🇳中文🇺🇸English', '中文English'],
        ['1️⃣2️⃣#️⃣*️⃣答案2026', '答案2026'], ['☀️天气☀︎不错', '天气不错'],
        ['🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}测试', '测试'],
        ['2026 # * + = 版本1.2\n第二行。', '2026 # * + = 版本1.2\n第二行。'],
        ['  喵呜～主人好呀！✨  ', '喵呜～主人好呀！'], ['   ', '']
    ]) assert.equal(filterQwenChatSpeechText(input), expected, input);
});

test('qwen-chat纯emoji不调用Chat2API、不写缓存；正文筛选后继续生成且真实失败仍抛出', async () => {
    const inputs = [];
    let stores = 0;
    let fail = false;
    const provider = createQwenChatProvider({ speechService: { generate: async request => {
        inputs.push(request.input);
        if (fail) throw new Error('实际上游失败');
        return { audio: wrapPcm(Buffer.from([1, 0])) };
    } } });
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat' }, providers: { 'qwen-chat': { enabled: true } } });
    const service = createTtsProviderService({ getSettings: () => settings, registry: { 'qwen-chat': provider },
        storeAudio: () => { stores += 1; return 'audio.wav'; } });
    for (const text of ['✨', '🐱💻⚡', '📶🐾', '❤️', '👨‍👩‍👧‍👦！']) {
        assert.equal(await service.generate({ text, businessType: 'ai_reply' }), null);
    }
    assert.deepEqual(inputs, []);
    assert.equal(stores, 0);
    assert.equal(await service.generate({ text: '你好🐱！', businessType: 'ai_reply' }), 'audio.wav');
    assert.deepEqual(inputs, ['你好！']);
    assert.equal(stores, 1);
    fail = true;
    await assert.rejects(service.generate({ text: '继续❤️。', businessType: 'ai_reply' }), /实际上游失败/u);
    assert.equal(stores, 1);
    assert.equal(await createQwenChatProvider().generate({ text: '✨', speed: 0 }, { enabled: true }), null);
    assert.equal(await provider.generate({ text: '✨' }, { enabled: false }), null);
});

test('qwen-chat筛选不影响其他Provider文本，其他云Provider空结果仍拒绝', async () => {
    let received;
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-api' }, providers: { 'qwen-api': { enabled: true } } });
    const service = createTtsProviderService({ getSettings: () => settings, registry: { 'qwen-api': { generate: async request => {
        received = request.text;
        return null;
    } } } });
    await assert.rejects(service.generate({ text: '你好🐱！', businessType: 'ai_reply' }), /WAV/u);
    assert.equal(received, '你好🐱！');
});

async function accountFixture(t, ticket) {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-tts-qwen-account-'));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    const dataStore = createChat2ApiDataStore({ rootDir });
    await dataStore.saveAccount({ accountId: 'qwen-test', providerId: 'qwen', credentials: { ticket } });
    return { dataStore };
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
    const adapter = createQwenChatProvider({ speechService: createChat2ApiSpeechService({ dataStore: accounts.dataStore,
        qwenAdapter: createChat2ApiQwenSpeechAdapter({ sign: async options => { signing = options; return { url, userAgent: 'test-browser' }; } }) }) });
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat' }, providers: { 'qwen-chat': { enabled: true, defaultSpeed: 10 } } });
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
    const adapter = createQwenChatProvider({ speechService: createChat2ApiSpeechService({ dataStore: accounts.dataStore,
        qwenAdapter: createChat2ApiQwenSpeechAdapter({ sign: async () => url }) }) });
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat' }, providers: { 'qwen-chat': { enabled: true } } });
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

test('签名迟到结果不连接音频；音频阶段只使用剩余总时限', async () => {
    let opened = 0;
    const adapter = createChat2ApiQwenSpeechAdapter({
        sign: async () => { await new Promise(resolve => setTimeout(resolve, 25)); return 'ws://127.0.0.1/tts'; },
        Socket: class { constructor() { opened += 1; } }
    });
    await assert.rejects(adapter.generate({ text: 'test', model: 'QUARK_VOICE', timeoutMs: 10 }, 'ticket'), /超时/u);
    assert.equal(opened, 0);
    assert.throws(() => parseCookies('Cookie: x=hello\r\nsecret'), /格式/u);
});

test('TTS只转交Chat2API语音，不读取手动凭证或账号引用', async () => {
    const requests = [];
    const provider = createQwenChatProvider({ speechService: { generate: async (...args) => { requests.push(args); return { audio: Buffer.from('test') }; } } });
    await provider.generate({ text: '测试', voice: 'voice', speed: 10, volume: 70, timeoutMs: 500 },
        { enabled: true, model: 'QUARK_VOICE', credential: 'legacy-secret', chat2apiAccountId: 'legacy-account' });
    assert.deepEqual(requests[0], [{ input: '测试', model: 'QUARK_VOICE', voice: 'voice', speed: 2, volume: 70 }, { timeoutMs: 500, signal:undefined, parameterDefaults:undefined, expectedProviderId:"qwen" }]);
    assert.ok(!JSON.stringify(requests).includes('legacy'));
    await provider.generate({ text: '测试', speed: 0, volume: 100 }, { enabled: false, model: 'QUARK_VOICE' });
    assert.equal(requests.length, 2, '旧Provider关闭字段不拦截，账号仍由Chat2API校验');
});

// 对应.src/framework/qwen-tts-fixed-models.md：最终网页适配器校验先于签名与连接。
test('网页旧MINI_MAX及伪造模型在签名前拒绝，薄层忽略旧模型', async () => {
    let signs = 0;
    const adapter = createChat2ApiQwenSpeechAdapter({ sign: async () => { signs++; throw Error('不应签名'); } });
    for (const model of ['MINI_MAX', 'my-voice', undefined]) {
        await assert.rejects(adapter.generate({ model, text: '你好', timeoutMs: 500 }, 'ticket'), e => e.code === 'unsupported_speech_model');
    }
    assert.equal(signs, 0);
    const { collectQwenAudio } = require('../src/apps/server/modules/chat2api/chat2api-qwen-speech-adapter');
    assert.throws(() => collectQwenAudio('ws://invalid', {}, { model: 'MINI_MAX' }, 'id'), e => e.code === 'unsupported_speech_model');
    let received;
    const provider = createQwenChatProvider({ speechService: { generate: async request => { received = request; return { audio: wrapPcm(Buffer.from([1, 0])) }; } } });
    await provider.generate({ text: '你好', speed: 0, volume: 100 }, { model: 'MINI_MAX' });
    assert.equal(received.model, 'QUARK_VOICE');
});
