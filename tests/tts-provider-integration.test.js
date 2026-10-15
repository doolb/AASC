'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createProviderRegistry } = require('../src/apps/server/modules/tts/tts-provider-registry');
const { createTtsProviderService } = require('../src/apps/server/modules/tts/tts-provider-service');
const { normalizeSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { requestLimited, requestJson, wrapPcm } = require('../src/apps/server/modules/tts/tts-provider-http');
const { createProviderError } = require('../src/apps/server/modules/tts/tts-provider-errors');
const { createChat2ApiDataStore } = require('../src/apps/server/modules/chat2api/chat2api-data-store');
const { createChat2ApiSpeechService } = require('../src/apps/server/modules/chat2api/chat2api-speech-service');
const { createApiSpeechAdapters } = require('../src/apps/server/modules/chat2api/chat2api-api-speech-adapters');
const cache = require('../src/external/tts/tts-audio-cache');

const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
const wav = wrapPcm(pcm);
async function mockServer(t, handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    return `http://127.0.0.1:${server.address().port}`;
}

// 旧settings中的值仅用于准备虚构测试账号；运行时生成仍经过真实Chat2API调度。
// 所有网络边界强制限定本地mock，配置接线错误也不得触碰真实官方接口。
async function registryFixture(t, settings, { seedAccounts = true, httpRequest = requestLimited,
    jsonRequest = requestJson, ...registryOptions } = {}) {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-tts-api-integration-'));
    t.after(async () => {
        assert.equal(path.dirname(rootDir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(rootDir).startsWith('aasc-tts-api-integration-'));
        await fs.promises.rm(rootDir, { recursive: true, force: true });
    });
    const dataStore = createChat2ApiDataStore({ rootDir });
    for (const [businessId, providerId] of [['qwen-api', 'qwen-api'], ['doubao-api', 'doubaapi']]) {
        const values = settings.providers[businessId];
        if (!seedAccounts || !values?.credential) continue;
        await dataStore.saveAccount({ accountId: `fixture-${providerId}`, providerId,
            credentials: { apiKey: values.credential }, accountInfo: { endpoint: values.endpoint, resourceId: values.resourceId } });
        if (values.model) await dataStore.saveModelMapping({ model: values.model, actualModel: values.model,
            preferredProviderId: providerId, application: 'tts' });
    }
    const localOnly = transport => async (url, options) => {
        assert.equal(new URL(url).hostname, '127.0.0.1', '集成测试只允许本地HTTP');
        return transport(url, options);
    };
    const apiAdapters = createApiSpeechAdapters({ httpRequest: localOnly(httpRequest), jsonRequest: localOnly(jsonRequest) });
    const chat2ApiSpeechService = createChat2ApiSpeechService({ dataStore, apiAdapters });
    return createProviderRegistry({ ...registryOptions, chat2ApiSpeechService });
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
    const service = createTtsProviderService({ getSettings: () => settings, registry: await registryFixture(t, settings) });
    const reference = await service.generate({ text: '你好', businessType: 'ai_reply' });
    assert.deepEqual(cache.getAudio(reference).buffer, wav);
    assert.equal(seen[0].auth, 'Bearer only-api-secret');
    assert.equal(seen[0].data.input.voice, 'qiaoxiaojiao_v3.1');
    assert.equal(seen[0].data.model, 'qwen-audio-3.1-tts-flash');
    assert.equal(seen[0].data.input.format, 'wav');
    assert.equal(seen[0].data.input.sample_rate, 24000);
    assert.equal(seen[0].data.input.language_type, undefined);
    assert.equal(seen[1].auth, undefined);
    assert.ok(cache.isMemoryAudioName(reference));
});

test('缺少Chat2API账号时不使用旧settings密钥、不请求上游或回退system', async t => {
    let upstreamCalls = 0;
    let fallback = 0;
    let stored = 0;
    const url = await mockServer(t, (req, res) => { upstreamCalls += 1; res.end(wav); });
    for (const provider of ['qwen-api', 'doubao-api']) {
        const settings = normalizeSettings({ aiReplyDefault: { provider },
            providers: { [provider]: { credential: 'legacy-fixture-key-only', endpoint: url } } });
        const registry = await registryFixture(t, settings, { seedAccounts: false, systemGenerate: () => { fallback += 1; } });
        const service = createTtsProviderService({ getSettings: () => settings, registry, storeAudio: () => { stored += 1; } });
        await assert.rejects(service.generate({ text: '需要用户准备API账号', businessType: 'ai_reply' }), error => {
            assert.equal(error.code, 'no_available_speech_account');
            assert.equal(error.provider, provider);
            assert.ok(!error.message.includes('legacy-fixture-key-only'));
            return true;
        });
    }
    assert.equal(upstreamCalls, 0); assert.equal(fallback, 0); assert.equal(stored, 0);
});

test('模板语音从Chat2API账号读取权威密钥与端点，原缓存仍保存完整WAV', async t => {
    const posted = [];
    const url = await mockServer(t, async (req, res) => {
        if (req.url === '/audio') { res.end(wav); return; }
        let body = '';
        for await (const chunk of req) body += chunk;
        posted.push({ auth: req.headers.authorization, body: JSON.parse(body) });
        res.end(JSON.stringify({ output: { audio: { url: `${url}/audio` } } }));
    });
    const settings = normalizeSettings({ providers: { 'qwen-api': { credential: 'account-fixture-authoritative', endpoint: `${url}/api` } } });
    const registry = await registryFixture(t, settings);
    // 完成测试账号准备后刻意改变旧业务配置，运行时必须继续使用账号内的权威值。
    settings.providers['qwen-api'].credential = 'obsolete-fixture-do-not-use';
    settings.providers['qwen-api'].endpoint = 'https://must-not-request.invalid/legacy';
    const service = createTtsProviderService({ getSettings: () => settings, registry });
    const reference = await service.generate({ text: '模板选择保持', businessType: 'ai_reply',
        templateTts: { provider: 'qwen-api', voice: 'template-fixture-voice' } });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].auth, 'Bearer account-fixture-authoritative');
    assert.equal(posted[0].body.input.voice, 'template-fixture-voice');
    assert.deepEqual(cache.getAudio(reference).buffer, wav);
    assert.ok(cache.isMemoryAudioName(reference));
});

test('Provider语速分别进入默认参数，共享音量一致，单次显式参数优先', async () => {
    const settings = normalizeSettings({ defaultVolume: 65,
        aiReplyDefault: { provider: 'qwen-api' }, textMedia: { provider: 'doubao-api' },
        systemBroadcast: { provider: 'qwen-chat' },
        providers: { 'qwen-api': { defaultSpeed: 4 }, 'doubao-api': { defaultSpeed: -2 }, 'qwen-chat': { defaultSpeed: 2 } } });
    const requests = {};
    const registry = Object.fromEntries(['qwen-api', 'doubao-api', 'qwen-chat'].map(id => [id, {
        generate: async request => { requests[id] = request; return wav; }
    }]));
    const service = createTtsProviderService({ getSettings: () => settings, registry, storeAudio: () => 'shared.wav' });
    await service.generate({ text: 'AI回复', businessType: 'ai_reply' });
    await service.generate({ text: '文本阅读', businessType: 'text_media' });
    await service.generate({ text: '系统播报', businessType: 'system_broadcast', speed: -3, volume: 22 });
    for (const [id, speed] of [['qwen-api', 4], ['doubao-api', -2]]) {
        assert.equal(requests[id].speed, speed);
        assert.equal(requests[id].volume, 65);
        assert.equal(requests[id].parameterDefaults.speed, Math.pow(2, speed / 10));
        assert.equal(requests[id].parameterDefaults.volume, 65);
    }
    assert.equal(requests['qwen-chat'].speed, -3);
    assert.equal(requests['qwen-chat'].volume, 22);
    assert.equal(requests['qwen-chat'].parameterOverrides.speed, Math.pow(2, -3 / 10));
    assert.equal(requests['qwen-chat'].parameterOverrides.volume, 22);
});

test('豆包网页朗读不声明语速参数，但仍应用全局音量', async () => {
    const settings = normalizeSettings({ defaultVolume: 65, aiReplyDefault: { provider: 'doubao-chat' },
        providers: { 'doubao-chat': { enabled: true, defaultSpeed: 8 } } });
    let request;
    const service = createTtsProviderService({ getSettings: () => settings, registry: { 'doubao-chat': {
        generate: async value => { request = value; return wav; }
    } }, storeAudio: () => 'doubao.wav' });
    await service.generate({ text: '固定速度', businessType: 'ai_reply' });
    assert.equal(request.speed, 0);
    assert.ok(!Object.hasOwn(request.parameterDefaults, 'speed'));
    assert.equal(request.volume, 65);
    assert.ok(!Object.hasOwn(settings.providers['doubao-chat'], 'defaultSpeed'));
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
        defaultSpeed: -10, defaultVolume: 50,
        providers: { 'doubao-api': { enabled: true, credential: 'doubao-key', endpoint: url } } });
    const service = createTtsProviderService({ getSettings: () => settings, registry: await registryFixture(t, settings) });
    const reference = await service.generate({ text: '阅读', businessType: 'text_media', templateTts: { provider: 'qwen-chat' } });
    const result = cache.getAudio(reference).buffer;
    assert.equal(result.readUInt32LE(24), 24000);
    assert.equal(result.readInt16LE(44), 1);
    assert.equal(posted.body.req_params.speaker, 'custom-reader');
    assert.equal(posted.body.req_params.audio_params.speech_rate, -50);
    assert.equal(posted.headers['x-api-key'], 'doubao-key');
    assert.equal(posted.headers['x-api-resource-id'], 'seed-tts-2.0');
});

test('豆包2.0真实HTTP携带上一句context_texts，其他业务/资源/复刻模型不发送', async t => {
    const posted = [];
    const url = await mockServer(t, async (req, res) => {
        let data = '';
        for await (const chunk of req) data += chunk;
        posted.push(JSON.parse(data));
        res.end(`${JSON.stringify({ code: 0, data: pcm.toString('base64') })}\n${JSON.stringify({ code: 20000000 })}`);
    });
    for (const [businessType, userText, resourceId, model, expected] of [
        ['ai_reply', '你能特别痛心地说吗？', 'seed-tts-2.0', '', '你能特别痛心地说吗？'],
        ['agent_reply', '上一轮Agent输入', 'seed-tts-2.0', '', '上一轮Agent输入'],
        ['ai_reply', '😀'.repeat(2100), 'seed-tts-2.0', '', '😀'.repeat(2000)],
        ['ai_reply', '', 'seed-tts-2.0', '', null],
        ['text_media', '用户输入', 'seed-tts-2.0', '', null],
        ['system_broadcast', '用户输入', 'seed-tts-2.0', '', null],
        ['ai_reply', '用户输入', 'seed-tts-1.0', '', null],
        ['ai_reply', '用户输入', 'seed-tts-2.0', 'seed-icl-2.0', null]
    ]) {
        const settings = normalizeSettings({ aiReplyDefault: { provider: 'doubao-api' }, textMedia: { provider: 'doubao-api' },
            systemBroadcast: { provider: 'doubao-api' }, providers: { 'doubao-api': { credential: 'test', endpoint: url, resourceId, model } } });
        const service = createTtsProviderService({ getSettings: () => settings, registry: await registryFixture(t, settings), storeAudio: () => 'test.wav' });
        await service.generate({ text: '朗读正文', businessType, userText });
        const params = posted.at(-1).req_params;
        assert.equal(params.text, '朗读正文');
        assert.equal(params.model, model || undefined);
        if (expected === null) assert.equal(params.additions, undefined);
        else {
            assert.equal(typeof params.additions, 'string');
            assert.deepEqual(JSON.parse(params.additions), { context_texts: [expected] });
        }
    }
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
    for (const [provider, modes] of [['qwen-api', ['auth', 'wav']], ['doubao-api', ['auth', 'empty', 'business', 'truncated']]]) {
        const settings = normalizeSettings({ aiReplyDefault: { provider }, providers: { [provider]: { enabled: true, credential: 'private-key', endpoint: url } } });
        const registry = await registryFixture(t, settings, { systemGenerate: () => { systemCalls += 1; },
            jsonRequest: async () => ({ output: { audio: { url } } }) });
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

test('system仍使用原引用和默认参数，旧关闭字段不拦截且600字边界仍拒绝', async t => {
    let request;
    const settings = normalizeSettings({ systemBroadcast: { voice: 'native' }, providers: { system: { defaultSpeed: 3 },
        'qwen-api': { credential: 'test', endpoint: 'http://127.0.0.1:1/unused' } } });
    const registry = await registryFixture(t, settings, { systemGenerate: async value => { request = value; return 'old-reference.wav'; } });
    const service = createTtsProviderService({ registry, getSettings: () => settings });
    assert.equal(await service.generate({ text: '报时', preferredDisplayId: 'display-a' }), 'old-reference.wav');
    assert.equal(request.voice, null);
    assert.equal(request.speed, 3);
    assert.equal(request.preferredDisplayId, 'display-a');
    await assert.rejects(registry['qwen-api'].generate({ text: '好'.repeat(601) }, { ...settings.providers['qwen-api'], enabled: false }), /600/u);
    await assert.rejects(registry['qwen-api'].generate({ text: '好'.repeat(601) }, settings.providers['qwen-api']), /600/u);
});

test('实际装配连接AI/Agent/临时/文本/系统入口和控制端重连；播放协议保持', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
    assert.match(source, /businessType: BUSINESS_TYPES.TEXT_MEDIA/u);
    assert.match(source, /businessType: BUSINESS_TYPES.AGENT_REPLY,\s*templateTts: chat.getTemplateByName/u);
    assert.match(source, /businessType: BUSINESS_TYPES.AI_REPLY,\s*templateTts: replyTemplateTts/u);
    assert.match(source, /isTemporaryConversation \? temporaryConversation.roleName : effectiveTemplateTarget/u);
    assert.match(source, /businessType: options.businessType \|\| BUSINESS_TYPES.SYSTEM_BROADCAST/u);
    assert.match(source, /ws.send\(JSON.stringify\(ttsProviderWs.snapshot\(\)\)\)/u);
    assert.match(source, /'setTtsProviderConfig', 'getTtsProviderVoices'/u);
    assert.match(source, /action: 'playAudio'/u);
    assert.match(source, /type: 'playOnControl'/u);
    assert.doesNotMatch(source, /app\.(get|post)\(['"]\/api\/tts\/providers/u);
});

test('Qwen HTTP与业务错误显示已知代码和中文原因，不缓存、不回退、不回显原文', async t => {
    const secret = 'qwen-fixture-secret';
    let current;
    let audioRequests = 0;
    let cached = 0;
    let fallback = 0;
    const url = await mockServer(t, (req, res) => {
        if (req.method !== 'POST') audioRequests += 1;
        res.writeHead(current.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: current.code, message: `${secret} https://audio.invalid/?signature=${secret}` }));
    });
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-api' },
        providers: { 'qwen-api': { enabled: true, credential: secret, endpoint: url } } });
    const service = createTtsProviderService({ getSettings: () => settings,
        registry: await registryFixture(t, settings, { systemGenerate: () => { fallback += 1; } }),
        storeAudio: () => { cached += 1; } });
    const cases = [
        [400, 'Arrearage', '账户欠费'],
        [401, 'InvalidApiKey', 'API Key 无效'],
        [403, 'Model.AccessDenied', '模型访问被拒绝'],
        [403, 'AccessDenied.Unpurchased', '服务尚未开通'],
        [400, 'InvalidParameter', '请求参数无效'],
        [400, 'InputRequired', '缺少必需输入'],
        [404, 'ModelNotFound', '模型不存在'],
        [429, 'Throttling.RateQuota', '请求频率超限'],
        [429, 'Throttling.AllocationQuota', '配额或吞吐超限'],
        [400, 'AllocationQuota.FreeTierOnly', '免费额度已耗尽'],
        [400, 'DataInspectionFailed', '文本未通过内容检查'],
        [500, 'InternalError', '上游内部错误'],
        [200, 'Arrearage', '账户欠费'],
        [200, 'InvalidParameter', '请求参数无效']
    ];
    for (const [status, code, reason] of cases) {
        await t.test(`${status}/${code}`, async () => {
            current = { status, code };
            await assert.rejects(service.generate({ text: '测试', businessType: 'ai_reply' }), error => {
                assert.equal(error.provider, 'qwen-api');
                assert.equal(error.upstreamCode, code);
                assert.ok(error.message.includes(`[${code}]`));
                assert.ok(error.message.includes(reason));
                assert.equal(error.message.includes(`HTTP ${status}`), status !== 200);
                assert.ok(!error.message.includes(secret));
                assert.ok(!JSON.stringify(error).includes(secret));
                assert.ok(!error.message.includes('https://'));
                if ([401, 403].includes(status)) assert.equal(error.code, 'TTS_PROVIDER_AUTH');
                return true;
            });
        });
    }
    assert.equal(audioRequests, 0);
    assert.equal(cached, 0);
    assert.equal(fallback, 0);
});

test('豆包HTTP与流内错误按官方固定标记区分参数、并发、音色资源和超时', async t => {
    const secret = 'doubao-fixture-secret';
    let current;
    let cached = 0;
    let fallback = 0;
    const url = await mockServer(t, (req, res) => {
        res.writeHead(current.status, { 'Content-Type': 'application/json' });
        // 原文故意含敏感字段，验证只输出已知原因，不保留消息或错误体。
        res.end(JSON.stringify({ code: current.code, message: `${current.marker}; ${secret} https://private.invalid/${secret}` }) + '\n');
    });
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'doubao-api' },
        providers: { 'doubao-api': { enabled: true, credential: secret, endpoint: url } } });
    const service = createTtsProviderService({ getSettings: () => settings,
        registry: await registryFixture(t, settings, { systemGenerate: () => { fallback += 1; } }),
        storeAudio: () => { cached += 1; } });
    const cases = [
        [45000000, 'quota exceeded for types: concurrency', '并发数超限'],
        [45000000, 'single request size too large', '单次请求过大'],
        [45000000, 'payload unmarshal: bad request', '请求格式无效'],
        [45000001, '[Invalid argument] speaker not found', '音色不存在'],
        [45000001, '[Invalid argument] InvalidModel', '模型参数无效'],
        [45002000, 'TTS invalid speaker', '音色参数无效'],
        [45002001, 'No readable text!', '没有可朗读内容'],
        [55000000, 'resource ID is mismatched with speaker related resource', '音色与资源 ID 不匹配'],
        [55000000, 'Request timeout: connect downstream service timeout', '连接语音服务超时'],
        [55000000, 'Request timeout: synthesis processing timeout', '合成处理超时'],
        [55000000, 'unrecognized internal detail', '上游内部错误']
    ];
    for (const [code, marker, reason] of cases) {
        for (const status of [400, 200]) {
            await t.test(`${status}/${code}/${reason}`, async () => {
                current = { status, code, marker };
                await assert.rejects(service.generate({ text: '测试', businessType: 'ai_reply' }), error => {
                    assert.equal(error.provider, 'doubao-api');
                    assert.equal(error.upstreamCode, String(code));
                    assert.ok(error.message.includes(`[${code}]`));
                    assert.ok(error.message.includes(reason));
                    assert.equal(error.message.includes(`HTTP ${status}`), status !== 200);
                    assert.ok(!error.message.includes(secret));
                    assert.ok(!JSON.stringify(error).includes(secret));
                    assert.ok(!error.message.includes('https://'));
                    return true;
                });
            });
        }
    }
    assert.equal(cached, 0);
    assert.equal(fallback, 0);
});

test('未知错误码、非JSON、大错误体与中断均只显示固定HTTP原因；成功请求可恢复', async t => {
    let mode;
    let successChunks = 0;
    const secret = 'error-response-secret';
    const url = await mockServer(t, (req, res) => {
        if (mode === 'recovery') { res.end(wav); return; }
        if (mode === 'oversize-header') {
            res.writeHead(400, { 'Content-Length': 32 * 1024 });
            res.end(JSON.stringify({ code: 'Arrearage', message: secret }));
            return;
        }
        res.writeHead(400);
        if (mode === 'oversize-chunked') { res.end('x'.repeat(16 * 1024 + 1)); return; }
        if (mode === 'abort') { res.write('{"code":"Arrearage",'); setImmediate(() => res.destroy()); return; }
        if (mode === 'non-json') { res.end(secret); return; }
        res.end(JSON.stringify({ code: mode === 'prototype' ? '__proto__' : secret, message: secret }));
    });
    for (const value of ['unknown', 'prototype', 'non-json', 'oversize-header', 'oversize-chunked', 'abort']) {
        await t.test(value, async () => {
            mode = value;
            await assert.rejects(requestLimited(url, {
                mapError: (result, status) => createProviderError('qwen-api', result, status),
                onChunk: () => { successChunks += 1; }
            }), error => {
                assert.match(error.message, /^Qwen API HTTP 400：请求无效/u);
                assert.equal(error.upstreamCode, undefined);
                assert.equal(error.code, 'TTS_PROVIDER_HTTP');
                assert.ok(!error.message.includes(secret));
                return true;
            });
        });
    }
    assert.equal(successChunks, 0);
    mode = 'recovery';
    assert.deepEqual((await requestLimited(url, { mapError: (result, status) => createProviderError('qwen-api', result, status) })).buffer, wav);
});

test('失败响应保留原总超时，HTTP状态回退与默认调用兼容', async t => {
    let status = 400;
    let stalled = false;
    const url = await mockServer(t, (req, res) => {
        res.writeHead(status);
        if (stalled) { res.write('{"code":'); return; }
        res.end('not-json-private-detail');
    });
    for (const [value, expected] of [[401, '凭证失效'], [403, '权限不足'], [429, '请求被限流'], [503, '服务暂不可用']]) {
        status = value;
        await assert.rejects(requestLimited(url, { mapError: (result, code) => createProviderError('doubao-api', result, code) }), error => {
            assert.ok(error.message.includes(`豆包 API HTTP ${value}`));
            assert.ok(error.message.includes(expected));
            return true;
        });
    }
    status = 400;
    // 不启用映射的音频下载、其他旧调用仍保留原错误行为。
    await assert.rejects(requestLimited(url), /^Error: TTS 上游 HTTP 400$/u);
    for (const mapError of [() => { throw new Error('private-callback-error'); }, () => null]) {
        await assert.rejects(requestLimited(url, { mapError }), /^Error: TTS 上游 HTTP 400$/u);
    }
    stalled = true;
    await assert.rejects(requestLimited(url, { timeoutMs: 30,
        mapError: (result, code) => createProviderError('qwen-api', result, code) }), error => {
        assert.equal(error.code, 'TTS_PROVIDER_TIMEOUT');
        assert.equal(error.message, 'TTS 上游请求超时');
        return true;
    });
});
