'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createProviderRegistry } = require('../src/apps/server/modules/tts/tts-provider-registry');
const { createTtsProviderService } = require('../src/apps/server/modules/tts/tts-provider-service');
const { normalizeSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { requestLimited, wrapPcm } = require('../src/apps/server/modules/tts/tts-provider-http');
const cache = require('../src/external/tts/tts-audio-cache');

const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
const wav = wrapPcm(pcm);
async function mockServer(t, handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    return `http://127.0.0.1:${server.address().port}`;
}

test('Qwen HTTP完整WAV进入原缓存，音频下载不携带API凭证', async t => {
    const seen = [];
    const url = await mockServer(t, async (req, res) => {
        let data = '';
        for await (const chunk of req) data += chunk;
        seen.push({ url: req.url, auth: req.headers.authorization, data: data ? JSON.parse(data) : null });
        if (req.url === '/audio') { res.end(wav); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ output: { audio: { url: `${url}/audio` } } }));
    });
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-api' },
        providers: { 'qwen-api': { enabled: true, credential: 'only-api-secret', endpoint: `${url}/api` } } });
    const service = createTtsProviderService({ getSettings: () => settings, registry: createProviderRegistry() });
    const reference = await service.generate({ text: '你好', businessType: 'ai_reply' });
    assert.deepEqual(cache.getAudio(reference).buffer, wav);
    assert.equal(seen[0].auth, 'Bearer only-api-secret');
    assert.equal(seen[0].data.input.voice, 'Cherry');
    assert.equal(seen[1].auth, undefined);
    assert.ok(cache.isMemoryAudioName(reference));
});

test('豆包分片UTF8/SSE完成事件与PCM包装；独立文本业务与参数传递', async t => {
    let posted;
    const url = await mockServer(t, async (req, res) => {
        let data = '';
        for await (const chunk of req) data += chunk;
        posted = { body: JSON.parse(data), headers: req.headers };
        const first = Buffer.from(`data: ${JSON.stringify({ code: 0, message: '成功', data: pcm.toString('base64') })}\n\n`);
        const split = first.indexOf(Buffer.from('成功')) + 1;
        res.write(first.subarray(0, split));
        res.write(first.subarray(split));
        res.end(JSON.stringify({ code: 20000000 }));
    });
    const settings = normalizeSettings({ textMedia: { provider: 'doubao-api', voice: 'custom-reader' },
        providers: { 'doubao-api': { enabled: true, credential: 'doubao-key', endpoint: url, defaultSpeed: -10, defaultVolume: 50 } } });
    const service = createTtsProviderService({ getSettings: () => settings, registry: createProviderRegistry() });
    const reference = await service.generate({ text: '阅读', businessType: 'text_media', templateTts: { provider: 'qwen-chat' } });
    const result = cache.getAudio(reference).buffer;
    assert.equal(result.readUInt32LE(24), 24000);
    assert.equal(result.readInt16LE(44), 1);
    assert.equal(posted.body.req_params.speaker, 'custom-reader');
    assert.equal(posted.body.req_params.audio_params.speech_rate, -50);
    assert.equal(posted.headers['x-api-key'], 'doubao-key');
    assert.equal(posted.headers['x-api-resource-id'], 'seed-tts-2.0');
});

test('鉴权、无效/截断/空音频、缺少完成事件均无缓存且不切换Provider', async t => {
    let mode = 'auth';
    const url = await mockServer(t, (req, res) => {
        if (mode === 'auth') { res.writeHead(401); res.end('private-key'); return; }
        if (mode === 'wav') { res.end(Buffer.from('RIFFxxxxWAVE')); return; }
        if (mode === 'empty') { res.end(JSON.stringify({ code: 20000000 })); return; }
        if (mode === 'business') { res.end(JSON.stringify({ code: 45000000, message: 'private-key' })); return; }
        res.end(JSON.stringify({ code: 0, data: pcm.toString('base64') }));
    });
    let systemCalls = 0;
    let cached = 0;
    const registry = createProviderRegistry({ systemGenerate: () => { systemCalls += 1; },
        jsonRequest: async () => ({ output: { audio: { url } } }) });
    for (const [provider, modes] of [['qwen-api', ['auth', 'wav']], ['doubao-api', ['auth', 'empty', 'business', 'truncated']]]) {
        const settings = normalizeSettings({ aiReplyDefault: { provider }, providers: { [provider]: { enabled: true, credential: 'private-key', endpoint: url } } });
        const service = createTtsProviderService({ getSettings: () => settings, registry, storeAudio: () => { cached += 1; } });
        for (const value of modes) {
            mode = value;
            await assert.rejects(service.generate({ text: '测试', businessType: 'ai_reply' }), error => {
                assert.equal(error.provider, provider);
                assert.ok(!error.message.includes('private-key'));
                return true;
            });
        }
    }
    assert.equal(systemCalls, 0);
    assert.equal(cached, 0);
});

test('HTTP总超时、容量限制与响应中断；成功后可继续生成', async t => {
    let mode = 'timeout';
    const url = await mockServer(t, (req, res) => {
        if (mode === 'timeout') return;
        if (mode === 'large') { res.writeHead(200, { 'Content-Length': 1024 }); res.end(Buffer.alloc(1024)); return; }
        if (mode === 'abort') { res.writeHead(200, { 'Content-Length': 1024 }); res.write('partial'); setImmediate(() => res.destroy()); return; }
        res.end(wav);
    });
    await assert.rejects(requestLimited(url, { timeoutMs: 20 }), /超时/u);
    mode = 'large';
    await assert.rejects(requestLimited(url, { maxBytes: 64 }), /容量/u);
    mode = 'abort';
    await assert.rejects(requestLimited(url), /中断|连接失败/u);
    mode = 'valid';
    assert.deepEqual((await requestLimited(url)).buffer, wav);
});

test('system仍使用原引用、选择默认参数，禁用和600字边界明确失败', async () => {
    let request;
    const registry = createProviderRegistry({ systemGenerate: async value => { request = value; return 'old-reference.wav'; } });
    const settings = normalizeSettings({ systemBroadcast: { voice: 'native' }, providers: { system: { defaultSpeed: 3 } } });
    const service = createTtsProviderService({ registry, getSettings: () => settings });
    assert.equal(await service.generate({ text: '报时', preferredDisplayId: 'display-a' }), 'old-reference.wav');
    assert.equal(request.voice, 'native');
    assert.equal(request.speed, 3);
    assert.equal(request.preferredDisplayId, 'display-a');
    await assert.rejects(registry['qwen-api'].generate({ text: 'test' }, settings.providers['qwen-api']), /未启用/u);
    await assert.rejects(registry['qwen-api'].generate({ text: '好'.repeat(601) }, { enabled: true, credential: 'test' }), /600/u);
});

test('实际装配连接AI/Agent/临时/文本/系统入口和控制端重连；播放协议保持', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
    assert.match(source, /businessType: BUSINESS_TYPES.TEXT_MEDIA/u);
    assert.equal((source.match(/businessType: BUSINESS_TYPES.AGENT_REPLY/gu) || []).length, 2);
    assert.match(source, /businessType: BUSINESS_TYPES.AI_REPLY, templateTts: replyTemplateTts/u);
    assert.match(source, /isTemporaryConversation \? temporaryConversation.roleName : effectiveTemplateTarget/u);
    assert.match(source, /businessType: options.businessType \|\| BUSINESS_TYPES.SYSTEM_BROADCAST/u);
    assert.match(source, /ws.send\(JSON.stringify\(ttsProviderWs.snapshot\(\)\)\)/u);
    assert.match(source, /'setTtsProviderConfig', 'getTtsProviderVoices'/u);
    assert.match(source, /action: 'playAudio'/u);
    assert.match(source, /type: 'playOnControl'/u);
    assert.doesNotMatch(source, /app\.(get|post)\(['"]\/api\/tts\/providers/u);
});
