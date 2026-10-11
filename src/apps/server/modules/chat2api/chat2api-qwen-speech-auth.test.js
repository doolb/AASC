'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createQwenSigner, buildSpeechSignature, parseCookies } = require('./chat2api-qwen-speech-auth');

// 测试伪代码见 .src/framework/tts-provider-configuration.md；本地契约不使用真实账号。
async function fixture(t, customize = () => {}) {
    const calls = [];
    let generation = 0;
    let time = Date.now();
    const server = http.createServer(async (request, response) => {
        let text = '';
        for await (const chunk of request) text += chunk;
        const url = new URL(request.url, 'http://localhost');
        const call = { path: url.pathname, query: url.searchParams, headers: request.headers, body: text ? JSON.parse(text) : null };
        calls.push(call);
        let data;
        if (url.pathname.includes('calibration')) {
            response.setHeader('Set-Cookie', 'calibrated=certificate; Path=/; HttpOnly');
            data = { millisTimeStamp: String(time) };
        } else {
            generation += 1;
            const token = scene => ({ ...(scene ? { businessScene: 'qwen_audio_asr' } : { 'eo-clt-dvidn': 'device' }),
                'eo-clt-actkn': scene ? `audio-${generation}` : `web-${generation}`, 'eo-clt-actkn-dl': Math.floor(time / 1000) + 7200,
                'eo-clt-bacsft': Array.from({ length: 100 }, (_, i) => `${generation}-${scene ? 'audio' : 'web'}-${i}`), 'eo-clt-snver': 'v1' });
            data = { ...token(false), unifyRelate: [token(true)] };
        }
        const result = { status: 0, data };
        await customize(call, result, response);
        if (!response.writableEnded) {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(result));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const sign = createQwenSigner({ securityEndpoint: `http://127.0.0.1:${server.address().port}`, now: () => time });
    const request = (reqid, credential = 'tongyi_sso_ticket=account-one') => sign({ reqid, credential, timeoutMs: 1000 });
    return { sign, request, calls, advance: ms => { time += ms; } };
}

test('官方HMAC固定向量、参数顺序、语音子场景与一次性令牌', () => {
    const scene = { accessToken: 'audio-token', tokens: ['salt'] };
    const result = buildSpeechSignature({ reqid: 'request', nonce: 'nonce', timestamp: 1700000000000, authTime: 1700000000123,
        base: { deviceId: 'device', version: 'v1' }, scene, kp: 'key' });
    const url = new URL(result.url);
    assert.equal(url.origin, 'wss://speech-tts.qianwen.com');
    assert.equal(url.pathname, '/api/v3/tts');
    assert.equal(url.searchParams.get('clt-acs-sign'), 'Eta6l8XQyx118YSP8qfQbOsKklzcVH93jPNBZ4TFbIg=');
    assert.equal(url.searchParams.get('clt-acs-request-params'), 'chid,nonce,timestamp');
    assert.equal(url.searchParams.get('eo-clt-actkn'), 'audio-token');
    assert.equal(url.searchParams.get('clt-acs-reqt'), '1700000000123');
    assert.equal(scene.tokens.length, 0);
});

test('真实本地HTTP校时Cookie与通用场景关联注册；同账号并发仅初始化一次', async t => {
    const { request, calls } = await fixture(t);
    const signed = await Promise.all(Array.from({ length: 6 }, (_, i) => request(`request-${i}`)));
    assert.equal(calls.length, 2);
    assert.match(calls[0].headers['eo-clt-acs-fgnt'], /^[0-9a-f]{32}$/u);
    const registration = calls[1];
    assert.equal(registration.body.businessScene, 'qwen_web');
    assert.deepEqual(registration.body.unifyRelateGenerate, ['qwen_audio_asr', 'voice_command']);
    assert.equal(registration.body.timezoneOffset, 'Asia/Shanghai');
    assert.equal(registration.body.fingerprint, calls[0].headers['eo-clt-acs-fgnt']);
    assert.equal(registration.body.chid, registration.query.get('chid'));
    assert.match(registration.headers.cookie, /calibrated=certificate/u);
    assert.equal(registration.headers['eo-clt-acs-bx-intss'], '2');
    assert.equal(registration.headers['bx-umidtoken'], '');
    const urls = signed.map(s => new URL(s.url));
    assert.equal(new Set(urls.map(u => u.searchParams.get('eo-clt-sacsft'))).size, 6);
    assert.deepEqual(urls.map(u => u.searchParams.get('chid')), Array.from({ length: 6 }, (_, i) => `request-${i}`));
    assert.ok(urls.every(u => u.searchParams.get('eo-clt-dvidn') === 'device' && u.searchParams.get('eo-clt-actkn') === 'audio-1'));
    assert.ok(!JSON.stringify(signed).includes('account-one'));
});

test('令牌不足及到期前刷新，关联场景继承设备ID并使用新语音令牌', async t => {
    const { request, calls, advance } = await fixture(t);
    for (let i = 0; i < 81; i += 1) await request(`sentence-${i}`);
    assert.equal(calls.filter(c => c.path.endsWith('/register')).length, 1);
    const refresh = calls.find(c => c.path.endsWith('/refresh'));
    assert.equal(refresh.query.get('businessScene'), 'qwen_web');
    assert.equal(refresh.query.get('unifyRelateGenerate'), 'qwen_audio_asr,voice_command');
    assert.equal(refresh.headers['eo-clt-actkn'], 'web-1');
    assert.equal(refresh.headers['eo-clt-dvidn'], 'device');
    const next = new URL((await request('after-refresh')).url);
    assert.equal(next.searchParams.get('eo-clt-actkn'), 'audio-2');
    advance(6000000);
    const renewed = new URL((await request('near-expiry')).url);
    assert.equal(renewed.searchParams.get('eo-clt-actkn'), 'audio-3');
});

test('不同账号及凭证更新隔离会话，不共享Cookie或令牌；闲置会话重新注册', async t => {
    const { request, calls, advance } = await fixture(t);
    const first = new URL((await request('one')).url);
    const second = new URL((await request('two', 'tongyi_sso_ticket=account-two')).url);
    const updated = new URL((await request('updated', 'tongyi_sso_ticket=account-updated')).url);
    assert.notEqual(first.searchParams.get('eo-clt-actkn'), second.searchParams.get('eo-clt-actkn'));
    assert.notEqual(second.searchParams.get('eo-clt-actkn'), updated.searchParams.get('eo-clt-actkn'));
    assert.equal(calls.filter(c => c.path.endsWith('/register')).length, 3);
    assert.match(calls[2].headers.cookie, /account-two/u);
    assert.ok(!calls[2].headers.cookie.includes('account-one'));
    advance(1800001);
    await request('idle-expired');
    assert.equal(calls.filter(c => c.path.endsWith('/register')).length, 4);
});

test('注册/刷新/校时错误固定脱敏，失败会话下次重新初始化', async t => {
    let mode = 'register';
    const { request, calls } = await fixture(t, (call, result) => {
        if (call.path.includes(mode)) { result.status = 1; result.message = 'private-cookie/signature-url'; }
    });
    await assert.rejects(request('register-fail'), e => e.code === 'speech_auth_register' && !e.message.includes('private'));
    mode = 'calibration';
    await assert.rejects(request('clock-fail'), e => e.code === 'speech_auth_calibration');
    mode = 'none';
    await request('recovered');
    mode = 'refresh';
    for (let i = 0; i < 79; i += 1) await request(`consume-${i}`);
    await assert.rejects(request('refresh-fail'), e => e.code === 'speech_auth_refresh');
    mode = 'none';
    await request('retry');
    assert.equal(calls.filter(c => c.path.endsWith('/register')).length, 3);
});

test('拒绝缺失、过期、重复、错误设备及超大响应，不能签名', async t => {
    for (const mode of ['missing', 'expired', 'duplicate', 'device', 'large', 'json', 'http', 'clock']) {
        await t.test(mode, async child => {
            const { request } = await fixture(child, (call, result, response) => {
                if (mode === 'clock') { result.data.millisTimeStamp = 'not-a-time'; return; }
                if (!call.path.endsWith('/register')) return;
                const audio = result.data.unifyRelate[0];
                const changes = {
                    missing: () => { result.data.unifyRelate = []; },
                    expired: () => { audio['eo-clt-actkn-dl'] = 1; },
                    duplicate: () => { audio['eo-clt-bacsft'] = ['same', 'same']; },
                    device: () => { audio['eo-clt-dvidn'] = 'another-device'; },
                    large: () => { response.end('x'.repeat(512 * 1024 + 1)); },
                    json: () => { response.end('not-json-private'); },
                    http: () => { response.statusCode = 401; }
                };
                changes[mode]();
            });
            await assert.rejects(request('invalid'), e => e.code === `speech_auth_${mode === 'clock' ? 'calibration' : 'register'}` && !e.message.includes('private'));
        });
    }
});

test('总超时中止在途请求；排队超时不会迟到注册，账号独立可继续', async () => {
    let fetches = 0;
    const sign = createQwenSigner({ fetchImpl: async (url, { signal }) => {
        fetches += 1;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private-url')), { once: true }));
    } });
    const one = sign({ credential: 'one', reqid: 'one', timeoutMs: 40 });
    const queued = sign({ credential: 'one', reqid: 'queued', timeoutMs: 10 });
    const other = sign({ credential: 'two', reqid: 'two', timeoutMs: 20 });
    const results = await Promise.allSettled([one, queued, other]);
    assert.ok(results.every(r => r.status === 'rejected' && r.reason.code === 'speech_auth_timeout'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fetches, 2);
});

test('活跃会话有界，超出16个不启动新的鉴权，凭证注入在网络前拒绝', async () => {
    let fetches = 0;
    const sign = createQwenSigner({ fetchImpl: (url, { signal }) => {
        fetches += 1;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    } });
    const pending = Array.from({ length: 16 }, (_, i) => sign({ credential: `account-${i}`, reqid: `request-${i}`, timeoutMs: 50 }));
    const results = Promise.allSettled(pending);
    await assert.rejects(sign({ credential: 'extra', reqid: 'extra', timeoutMs: 50 }), e => e.code === 'speech_auth_capacity');
    await results;
    assert.equal(fetches, 16);
    assert.throws(() => parseCookies('Cookie: x=private\r\nHeader=value'), e => e.code === 'speech_auth_credentials' && !e.message.includes('private'));
    await assert.rejects(sign({ credential: 'ticket', reqid: 'private\nrequest', timeoutMs: 100 }), e => e.code === 'speech_auth_credentials');
    assert.equal(fetches, 16);
});
