'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { getEventListeners } = require('node:events');
const { wrapPcm, validateWav } = require('../../../../external/tts/tts-wav');
const { requestLimited } = require('../tts/tts-provider-http');

const { createApiSpeechAdapters } = require('./chat2api-api-speech-adapters');
function adapters(options) {
    return createApiSpeechAdapters(options);
}
const pcm = Buffer.from([100, 0, 200, 0, 44, 1, 144, 1]);
const wav = wrapPcm(pcm);
const request = { text: '朗读😀', model: 'qwen-audio-3.1-tts-flash', voice: 'qiaoxiaojiao_v3.1', speed: 1, volume: 100, timeoutMs: 1000 };
async function serverFor(t, handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    return `http://127.0.0.1:${server.address().port}`;
}
async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

test('Qwen完整WAV与真实模型/音色合同；下载不带任何凭证', async t => {
    const seen = [];
    const url = await serverFor(t, async (req, res) => {
        if (req.url === '/audio') { seen.push({ headers: req.headers }); res.end(wav); return; }
        seen.push({ headers: req.headers, body: await readBody(req) });
        res.end(JSON.stringify({ output: { audio: { url: `${url}/audio` } } }));
    });
    const result = await adapters()['qwen-api'].generate(request, 'qwen-fixture-key', { provider: { apiEndpoint: `${url}/api` } });
    assert.deepEqual(result, wav);
    assert.deepEqual(seen[0].body, { model: 'qwen-audio-3.1-tts-flash', input: { text: '朗读😀', voice: 'qiaoxiaojiao_v3.1', format: 'wav', sample_rate: 24000 } });
    assert.equal(seen[0].headers.authorization, 'Bearer qwen-fixture-key');
    for (const key of ['authorization', 'cookie', 'x-api-key']) assert.equal(seen[1].headers[key], undefined);
    assert.ok(!JSON.stringify(seen[0].body).includes('qwen-fixture-key'));
});

test('Qwen官方路径、600 Unicode边界、占位WAV头与倍率速度保持原语义', async () => {
    const calls = [];
    const placeholder = Buffer.from(wav);
    placeholder.writeUInt32LE(0x7fffffbf, 4); placeholder.writeUInt32LE(0x7fffff9b, 40);
    const api = adapters({ jsonRequest: async (url, options) => { calls.push({ url, options }); return { output: { audio: { url: 'https://audio.invalid/fixture' } } }; },
        httpRequest: async () => ({ buffer: placeholder }) });
    const result = await api['qwen-api'].generate({ ...request, text: '好' + '😀'.repeat(599), speed: 2, volume: 50 }, 'fixture', { provider: { apiEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation' } });
    validateWav(result);
    assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
    assert.equal(result.length, 48); assert.equal(result.readInt16LE(44), 50); assert.equal(result.readInt16LE(46), 150);
    await assert.rejects(api['qwen-api'].generate({ ...request, text: '好' + '😀'.repeat(600) }, 'fixture', {}), /600/u);
    assert.equal(calls.length, 1);
    assert.equal((await api['qwen-api'].voices({ model: request.model }))[0].id, 'qiaoxiaojiao_v3.1');
});

test('豆包流的UTF8分片/完成事件输出WAV，资源与复刻model分开', async t => {
    const posted = [];
    const url = await serverFor(t, async (req, res) => {
        posted.push({ headers: req.headers, body: await readBody(req) });
        const first = Buffer.from(`data: ${JSON.stringify({ code: 0, message: '成功', data: pcm.toString('base64') })}\n\n`);
        const split = first.indexOf(Buffer.from('成功')) + 1;
        res.write(first.subarray(0, split)); res.write(first.subarray(split)); res.end('{"code":20000000}');
    });
    const api = adapters().doubaapi;
    const result = await api.generate({ ...request, model: '', speed: 0.5, volume: 50 }, 'doubao-fixture-key', { provider: { apiEndpoint: url }, legacyReplyContext: { businessType: 'ai_reply', userText: '上一句' } });
    validateWav(result); assert.equal(result.readInt16LE(44), 50);
    assert.equal(posted[0].headers['x-api-resource-id'], 'seed-tts-2.0'); assert.equal(posted[0].headers['x-api-key'], 'doubao-fixture-key');
    assert.equal(posted[0].body.req_params.model, undefined);
    assert.equal(posted[0].body.req_params.audio_params.speech_rate, -50);
    assert.deepEqual(JSON.parse(posted[0].body.req_params.additions), { context_texts: ['上一句'] });
    await api.generate({ ...request, model: 'seed-icl-2.0', businessType: 'ai_reply', userText: '请求不能自行附加' }, 'fixture', { provider: { apiEndpoint: url, resourceId: 'seed-tts-2.0' }, legacyReplyContext: { businessType: 'ai_reply', userText: '上一句' } });
    assert.equal(posted[1].body.req_params.model, 'seed-icl-2.0'); assert.equal(posted[1].body.req_params.additions, undefined);
    await api.generate({ ...request, model: '', businessType: 'ai_reply', userText: '请求不能自行附加' }, 'fixture', { provider: { apiEndpoint: url } });
    assert.equal(posted[2].body.req_params.additions, undefined);
    for (const [businessType, resourceId] of [['text_media', 'seed-tts-2.0'], ['agent_reply', 'seed-tts-1.0']]) {
        await api.generate({ ...request, model: '' }, 'fixture', { provider: { apiEndpoint: url, resourceId }, legacyReplyContext: { businessType, userText: '上一句' } });
        assert.equal(posted.at(-1).body.req_params.additions, undefined);
    }
});

test('豆包缺完成、完成后事件、无效PCM与过大事件都拒绝', async () => {
    for (const stream of [
        `{"code":0,"data":"${pcm.toString('base64')}"}\n`,
        '{"code":20000000}\n{"code":0}\n',
        '{"code":20000000}',
        '{"code":20000000,"data":"AQ=="}',
        'x'.repeat(24 * 1024 * 1024 + 1)
    ]) {
        const api = adapters({ httpRequest: async (url, options) => { options.onChunk(Buffer.from(stream)); } });
        await assert.rejects(api.doubaapi.generate({ ...request, model: '' }, 'fixture', { provider: { apiEndpoint: 'http://local.invalid/' } }));
    }
});

test('Qwen与豆包失败固定脱敏且不重试、不跟随重定向', async t => {
    let calls = 0;
    const secret = 'secret-http-fixture';
    let mode = 'error';
    const url = await serverFor(t, (req, res) => {
        calls += 1;
        res.writeHead(mode === 'redirect' ? 302 : 400, { Location: `${url}/redirect-target` });
        res.end(JSON.stringify({ code: 'unknown-' + secret, message: secret, url: `${url}/?token=${secret}` }));
    });
    for (const provider of ['qwen-api', 'doubaapi']) {
        for (const value of ['error', 'redirect']) {
            mode = value;
            const before = calls;
            await assert.rejects(adapters()[provider].generate(request, secret, { provider: { apiEndpoint: url } }), error => {
                assert.ok(!error.message.includes(secret)); assert.ok(!JSON.stringify(error).includes(secret)); return true;
            });
            assert.equal(calls, before + 1);
        }
    }
});

test('Qwen合成后挂起下载使用剩余总预算；不重新开始超时', async t => {
    let audioRequests = 0;
    let downloadTimeoutMs;
    const url = await serverFor(t, (req, res) => {
        if (req.url === '/audio') { audioRequests += 1; res.write('partial'); return; }
        setTimeout(() => res.end(JSON.stringify({ output: { audio: { url: `${url}/audio` } } })), 70);
    });
    const start = Date.now();
    const api = adapters({ httpRequest: (target, options) => { downloadTimeoutMs = options.timeoutMs; return requestLimited(target, options); } });
    await assert.rejects(api['qwen-api'].generate({ ...request, timeoutMs: 130 }, 'fixture', { provider: { apiEndpoint: url } }), error => error.code === 'TTS_PROVIDER_TIMEOUT');
    assert.equal(audioRequests, 1); assert.ok(downloadTimeoutMs > 0 && downloadTimeoutMs < 90, '合成耗时必须从下载预算扣除');
    assert.ok(Date.now() - start < 1000, '挂起下载必须实际终止');
});

test('Qwen合成和下载分别取消，豆包流取消后均释放监听', async t => {
    let markStarted;
    let phase;
    const url = await serverFor(t, (req, res) => {
        if (phase === 'download' && req.url !== '/audio') { res.end(JSON.stringify({ output: { audio: { url: `${url}/audio` } } })); return; }
        res.write('partial'); markStarted();
    });
    for (const [provider, value] of [['qwen-api', 'synthesis'], ['qwen-api', 'download'], ['doubaapi', 'stream']]) {
        phase = value;
        const started = new Promise(resolve => { markStarted = resolve; });
        const controller = new AbortController();
        const rejected = assert.rejects(adapters()[provider].generate(request, 'fixture', { provider: { apiEndpoint: url }, signal: controller.signal }), error => error.code === 'ABORT_ERR');
        await started; controller.abort('private-abort'); await rejected;
        assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    }
});

test('预取消、过期deadline和非法参数均零上游请求，总预算上限60秒', async () => {
    let calls = 0;
    const api = adapters({ jsonRequest: async (url, options) => { calls += 1; assert.ok(options.timeoutMs <= 60000); return { output: { audio: { url: 'http://audio.invalid/' } } }; },
        httpRequest: async (url, options) => { calls += 1; assert.ok(options.timeoutMs <= 60000); return { buffer: wav }; } });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api['qwen-api'].generate(request, 'fixture', { signal: controller.signal }), error => error.code === 'ABORT_ERR');
    await assert.rejects(api['qwen-api'].generate(request, 'fixture', { deadline: Date.now() - 1 }), error => error.code === 'TTS_PROVIDER_TIMEOUT');
    for (const patch of [{ speed: 0 }, { speed: 4.1 }, { volume: 101 }, { text: '' }, { text: '😀' }]) await assert.rejects(api['qwen-api'].generate({ ...request, ...patch }, 'fixture', {}));
    assert.equal(calls, 0);
    await api['qwen-api'].generate({ ...request, timeoutMs: 120000 }, 'fixture', {});
    assert.equal(calls, 2);
});

test('Qwen无效/截断WAV与下载容量上限拒绝，签名URL错误不回显', async t => {
    let mode;
    const invalid = Buffer.from(wav); invalid.writeUInt32LE(wav.length + 1, 4);
    const url = await serverFor(t, (req, res) => {
        if (req.url.startsWith('/audio')) {
            if (mode === 'oversize') { res.writeHead(200, { 'Content-Length': 16 * 1024 * 1024 + 1 }); res.end('fixture'); return; }
            if (mode === 'truncated') { res.writeHead(200, { 'Content-Length': wav.length }); res.write(wav.subarray(0, 44)); setImmediate(() => res.destroy()); return; }
            res.end(invalid); return;
        }
        const target = mode === 'url' ? 'fixture-invalid?signature=private-signature' : `${url}/audio?signature=private-signature`;
        res.end(JSON.stringify({ output: { audio: { url: target } } }));
    });
    for (const value of ['invalid', 'oversize', 'truncated', 'url']) {
        mode = value;
        await assert.rejects(adapters()['qwen-api'].generate(request, 'fixture', { provider: { apiEndpoint: url } }), error => {
            assert.ok(!error.message.includes('private-signature')); return true;
        });
    }
});

test('豆包累计PCM容量边界拒绝；错误事件保持官方原因并隐藏原文', async () => {
    const oversized = Buffer.alloc(16 * 1024 * 1024 - 44 + 2).toString('base64');
    const api = adapters({ httpRequest: async (url, options) => { options.onChunk(Buffer.from(JSON.stringify({ code: 0, data: oversized }))); } });
    await assert.rejects(api.doubaapi.generate({ ...request, model: '' }, 'fixture', {}), /上限/u);
    const errorApi = adapters({ httpRequest: async (url, options) => { options.onChunk(Buffer.from('{"code":55000000,"message":"resource ID is mismatched with speaker related resource; private-fixture-secret"}\n')); } });
    await assert.rejects(errorApi.doubaapi.generate({ ...request, model: '' }, 'fixture', {}), error => {
        assert.match(error.message, /音色与资源 ID 不匹配/u);
        assert.ok(!error.message.includes('private-fixture-secret')); return true;
    });
});

test('request与context不同取消源各自都能取消HTTP并移除监听', { timeout: 2000 }, async t => {
    let markStarted;
    let markClosed;
    const url = await serverFor(t, (req, res) => {
        res.on('close', () => markClosed()); res.write('{'); markStarted();
    });
    for (const origin of ['request', 'context']) {
        const first = new AbortController(); const second = new AbortController();
        const started = new Promise(resolve => { markStarted = resolve; });
        const closed = new Promise(resolve => { markClosed = resolve; });
        const rejected = assert.rejects(adapters()['qwen-api'].generate({ ...request, signal: first.signal }, 'fixture', { provider: { apiEndpoint: url }, signal: second.signal }), error => error.code === 'ABORT_ERR');
        await started; (origin === 'request' ? first : second).abort(); await rejected; await closed;
        assert.equal(getEventListeners(first.signal, 'abort').length, 0);
        assert.equal(getEventListeners(second.signal, 'abort').length, 0);
    }
});

test('非法凭证与上游端点均在请求前受控拒绝', async () => {
    let calls = 0;
    const api = adapters({ jsonRequest: async () => { calls += 1; }, httpRequest: async () => { calls += 1; } });
    for (const credential of ['', 'private-fixture\nkey', { apiKey: 'private-fixture' }, '私人密钥']) {
        await assert.rejects(api['qwen-api'].generate(request, credential, {}), error => {
            assert.equal(error.code, 'TTS_PROVIDER_AUTH'); assert.ok(!error.message.includes('private-fixture')); return true;
        });
    }
    for (const apiEndpoint of ['ftp://private-fixture/audio', 'http://private-fixture:secret@localhost/', 'invalid-private-fixture']) {
        await assert.rejects(api['qwen-api'].generate(request, 'fixture', { provider: { apiEndpoint } }), error => {
            assert.ok(!error.message.includes('private-fixture')); return true;
        });
    }
    assert.equal(calls, 0);
});
