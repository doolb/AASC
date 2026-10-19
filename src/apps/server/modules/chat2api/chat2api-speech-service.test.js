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
const { DOUBAO_SPEECH_VOICE, doubaoSpeechError } = require('./chat2api-doubao-speech-protocol');

test('排队本地失败不扣账号健康，上游超时仍记录失败且外部错误不暴露内部标记', async t => {
    const failed=[];let queueFailure=true;
    const {dataStore,service}=await fixture(t,{
        loadBalancer:{selectAccount:async()=>({account:{accountId:'bound'}}),markAccountFailed:id=>failed.push(id)},
        doubaoAdapter:{generate:async()=>{throw Object.assign(doubaoSpeechError('doubao_speech_timeout'),{speechQueueFailure:queueFailure})}}
    });
    await dataStore.saveAccount({accountId:'bound',providerId:'doubaochat',credentials:{cookie:'sessionid=demo_session_12345678; passport_csrf_token=demo_csrf_12345678'}});
    await assert.rejects(service.generate({input:'等待超时',model:'doubao-chat'}),e=>e.code==='doubao_speech_timeout'&&!Object.hasOwn(e,'speechQueueFailure'));
    assert.deepEqual(failed,[]);queueFailure=false;
    await assert.rejects(service.generate({input:'上游超时',model:'doubao-chat'}),e=>e.code==='doubao_speech_timeout');
    assert.deepEqual(failed,['bound']);
});

test('doubao-chat无手动映射自动选择同Provider可用账号并读取更新凭据', async t => {
    const calls=[];const {dataStore,service}=await fixture(t,{doubaoAdapter:{generate:async(...args)=>{calls.push(args);return audio;}}});
    const cookie='sessionid=demo_session_12345678; passport_csrf_token=demo_csrf_12345678';
    for(const account of [
        {accountId:'qwen',providerId:'qwen',credentials:{ticket:'private-qwen'}},
        {accountId:'disabled',providerId:'doubaochat',enabled:false,credentials:{cookie}},
        {accountId:'limited',providerId:'doubaochat',todayUsed:2,todayLimit:2,credentials:{cookie}},
        {accountId:'daily-limited',providerId:'doubaochat',todayUsed:2,dailyLimit:2,credentials:{cookie}},
        {accountId:'available',providerId:'doubaochat',credentials:{cookie}},
    ])await dataStore.saveAccount(account);
    assert.equal((await service.voices('doubao-chat')).length,94);
    assert.deepEqual(await service.generate({input:'自动选择',model:'doubao-chat'}),{audio,contentType:'audio/wav'});
    assert.equal(calls[0][2].accountId,'available');assert.equal(calls[0][1],cookie);
    const next='sessionid=updated_session_123456789; passport_csrf_token=updated_csrf_123456789';
    await dataStore.updateAccount('available',{credentials:{cookie:next}});
    await service.generate({input:'更新凭据',model:'doubao-chat'});
    assert.equal(calls[1][1],next);
    await dataStore.deleteAccount('available');
    await assert.rejects(service.generate({input:'无可用账号',model:'doubao-chat'}),e=>e.code==='no_available_speech_account'&&/登录/u.test(e.message));
    assert.equal(calls.length,2);
});

test('豆包未绑定多账号轮询_一次上游失败不重发或调用千问', async t => {
    const calls=[];let fail=false;
    const {dataStore,service}=await fixture(t,{doubaoAdapter:{generate:async(request,credential,context)=>{calls.push(context.accountId);if(fail)throw Error('private-cookie');return audio;}}});
    const cookie='sessionid=demo_session_12345678; passport_csrf_token=demo_csrf_12345678';
    for(const accountId of ['one','two'])await dataStore.saveAccount({accountId,providerId:'doubaochat',credentials:{cookie}});
    await service.generate({input:'第一次',model:'doubao-chat'});await service.generate({input:'第二次',model:'doubao-chat'});
    assert.deepEqual(calls,['one','two']);fail=true;
    await assert.rejects(service.generate({input:'失败一次',model:'doubao-chat'}),e=>e.code==='doubao_speech_upstream');
    assert.equal(calls.length,3);
});

test('doubao-chat语音严格采用显式映射账号，不回退其他账号或千问，读取权威更新', async t => {
    const calls=[];const {dataStore,service}=await fixture(t,{doubaoAdapter:{generate:async(...args)=>{calls.push(args);return audio}}});
    const cookie='sessionid=demo_session_12345678; passport_csrf_token=demo_csrf_12345678';
    await dataStore.saveAccount({accountId:'bound',providerId:'doubaochat',credentials:{cookie}});
    await dataStore.saveAccount({accountId:'other',providerId:'doubaochat',credentials:{cookie}});
    await dataStore.writeCollection('modelMappings',[{model:'doubao-chat',actualModel:'doubao-chat',preferredProviderId:'doubaochat',preferredAccountId:'bound'}]);
    assert.deepEqual(await service.generate({input:'模拟语音',model:'doubao-chat'}),{audio,contentType:'audio/wav'});
    assert.equal(calls[0][0].voice,DOUBAO_SPEECH_VOICE);assert.equal(calls[0][2].accountId,'bound');
    await dataStore.updateAccount('bound',{enabled:false});
    await assert.rejects(service.generate({input:'禁止回退',model:'doubao-chat'}),e=>e.code==='no_available_speech_account');assert.equal(calls.length,1);
});
test('豆包固定参数、文本字节/字符及格式先校验，不能使用千问音色或API参数', () => {
    for(const patch of [{voice:'zh_female_quarkF531S0_ptts'},{speed:2},{volume:90},{response_format:'ogg'},
        {input:'x'.repeat(1001)},{input:'😀'.repeat(600)}]) {
        assert.throws(()=>normalizeSpeechRequest({input:'x',model:'doubao-chat',...patch}),e=>e.code==='invalid_speech_request');
    }
    assert.equal(normalizeSpeechRequest({input:'x',model:'doubao-chat'}).voice,DOUBAO_SPEECH_VOICE);
    assert.equal(normalizeSpeechRequest({input:'你好（耳朵通红）呀',model:'doubao-chat'}).text,'你好耳朵通红呀');
    assert.equal(normalizeSpeechRequest({input:'( 轻轻蹭了蹭你的脸颊)',model:'doubao-chat'}).text,'轻轻蹭了蹭你的脸颊');
    assert.equal(normalizeSpeechRequest({input:'你好（耳朵通红）呀',model:'qwen-chat'}).text,'你好（耳朵通红）呀');
    assert.equal(normalizeSpeechRequest({input:'(plain)',model:'qwen-chat'}).text,'(plain)');
    assert.throws(()=>normalizeSpeechRequest({input:'（）',model:'doubao-chat'}),e=>e.code==='invalid_speech_request');
    assert.throws(()=>normalizeSpeechRequest({input:'()',model:'doubao-chat'}),e=>e.code==='invalid_speech_request');
});
test('豆包请求取消/超时透传signal，坏上游错误固定脱敏', async t => {
    const controller=new AbortController();controller.abort();let calls=0;
    const {dataStore,service}=await fixture(t,{doubaoAdapter:{generate:async()=>{calls++;throw new Error('private-cookie')}}});
    await assert.rejects(service.generate({input:'x',model:'doubao-chat'},{signal:controller.signal}),e=>e.code==='doubao_speech_cancelled');
    assert.equal(calls,0);
    await dataStore.saveAccount({accountId:'bound',providerId:'doubaochat',credentials:{cookie:'sessionid=demo_session_12345678; passport_csrf_token=demo_csrf_12345678'}});
    await dataStore.writeCollection('modelMappings',[{model:'doubao-chat',actualModel:'doubao-chat',preferredProviderId:'doubaochat',preferredAccountId:'bound'}]);
    await assert.rejects(service.generate({input:'x',model:'doubao-chat'}),e=>!e.message.includes('private')&&e.code==='doubao_speech_upstream');
});

test('HTTP speech客户端断连取消对应豆包任务，不继续生成或影响后续请求', async t => {
    const http=require('node:http');let entered,aborted;
    const begun=new Promise(resolve=>{entered=resolve});const stopped=new Promise(resolve=>{aborted=resolve});
    const {rootDir,dataStore}=await fixture(t);
    await dataStore.saveAccount({accountId:'bound',providerId:'doubaochat',credentials:{cookie:'sessionid=demo_session_12345678; passport_csrf_token=demo_csrf_12345678'}});
    await dataStore.writeCollection('modelMappings',[{model:'doubao-chat',actualModel:'doubao-chat',preferredProviderId:'doubaochat',preferredAccountId:'bound'}]);
    const runtime=createChat2ApiRuntime({rootDir,dataStore,host:'127.0.0.1',port:0,doubaoSpeechAdapter:{generate:(request,credential,context)=>new Promise((resolve,reject)=>{
        entered();context.signal.addEventListener('abort',()=>{aborted();reject(Object.assign(new Error('已取消'),{code:'doubao_speech_cancelled'}))},{once:true});
    })}});
    await runtime.start();t.after(()=>runtime.stop());const key=await dataStore.createApiKey({label:'local-cancel'});
    const req=http.request(`http://127.0.0.1:${runtime.getStatus().address.port}/v1/audio/speech`,{method:'POST',headers:{Authorization:`Bearer ${key.value}`,'Content-Type':'application/json'}});
    req.on('error',()=>{});req.end(JSON.stringify({input:'本地模拟',model:'doubao-chat'}));
    await Promise.race([begun,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('mock未开始')),1000);timer.unref()})]);req.destroy();
    await Promise.race([stopped,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('取消未到达')),1000);timer.unref()})]);
});

async function fixture(t, options = {}) {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat2api-speech-'));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    const dataStore = createChat2ApiDataStore({ rootDir });
    const calls = [];
    const service = createChat2ApiSpeechService({ dataStore, qwenAdapter: { generate: async (...args) => { calls.push(args); return audio; } }, ...options });
    return { rootDir, dataStore, calls, service };
}

test('Qwen Chat 连续限流保留原音色重排直到成功，普通错误不无限重试', async t => {
    let attempts = 0;
    const rateGate = { waitForStart: async (accountId, model) => {
        assert.equal(accountId, 'one'); assert.equal(model, 'QUARK_VOICE');
    } };
    const { dataStore, service } = await fixture(t, { qwenChatRateGate: rateGate, qwenAdapter: { generate: async request => {
        attempts += 1;
        assert.equal(request.voice, 'same-voice');
        if (attempts < 3) throw Object.assign(new Error('国内千问朗读请求频率超限'), { code: 'speech_rate_limited' });
        return audio;
    } } });
    await dataStore.saveAccount({ accountId: 'one', providerId: 'qwen', credentials: { ticket: 'fixture-ticket' } });
    assert.deepEqual(await service.generate({ input: '不能丢失', model: 'qwen-chat', voice: 'same-voice' }), { audio, contentType: 'audio/wav' });
    assert.equal(attempts, 3);
});

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
