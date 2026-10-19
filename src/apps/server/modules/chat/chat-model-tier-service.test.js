'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChatModelTierService, identifyModel } = require('./chat-model-tier-service');

function setup(initialModel = 'gpt-3.5-turbo') {
    let saved = null;
    const profile = { name: 'direct', mode: 'llm', model: initialModel };
    const broadcasts = [];
    const saves = [];
    const requests = [];
    const runtime = {
        getStatus: () => ({ running: true }),
        dataStore: { listAccounts: async () => [
            { providerId: 'qwen', enabled: true, secretConfigured: true },
            { providerId: 'doubaochat', enabled: true, secretConfigured: true },
            { providerId: 'deepseek', enabled: true, secretConfigured: true }
        ] },
        providerRegistry: { listProviders: async () => [
            { id: 'qwen', enabled: true }, { id: 'doubaochat', enabled: true },
            { id: 'deepseek', enabled: true }
        ] },
        responsesService: { async createResponse(payload) {
            requests.push(payload);
            if (payload.stream) return { stream: (async function* () {
                yield { type: 'response.output_text.delta', delta: 'ok' };
                yield { type: 'response.completed', response: { id: 'resp_ok' } };
            }()) };
            return { body: { output_text: 'ok' } };
        } }
    };
    const config = {
        get: key => key === 'chat.modelTierSelection' ? saved : null,
        set(_key, value) { saved = value; return true; }
    };
    return {
        runtime, requests, broadcasts, profile, saves,
        service: createChatModelTierService({ config, getRuntime: () => runtime,
            getActiveProfile: () => profile,
            saveActiveModel: async (model, preference) => {
                profile.model = model;
                saved = preference;
                saves.push({ model, preference });
            },
            broadcast: message => broadcasts.push(message) })
    };
}

test('每个 Provider 记住自己的档位，Qwen 默认普通、豆包默认轻量', async () => {
    const { service, broadcasts, profile, saves } = setup();
    assert.deepEqual(service.selection(), {
        providerId: null, tiersByProvider: { qwen: 'flash', doubaochat: 'mini' },
        modelName: 'gpt-3.5-turbo', profileName: 'direct', profileMode: 'llm'
    });
    assert.deepEqual((await service.availableProviders()).map(item => item.id), ['qwen', 'doubaochat']);
    await service.update({ providerId: 'qwen', tier: 'pro' });
    assert.equal(profile.model, 'Qwen3.7-Max');
    await service.update({ providerId: 'doubaochat' });
    assert.equal(profile.model, 'doubao');
    assert.deepEqual(service.selection(), {
        providerId: 'doubaochat', tiersByProvider: { qwen: 'pro', doubaochat: 'mini' },
        modelName: 'doubao', profileName: 'direct', profileMode: 'llm'
    });
    assert.equal(saves.length, 2);
    assert.equal(broadcasts.at(-1).selection.providerId, 'doubaochat');
});

test('直接按当前模型名识别 Provider 和档位，不读取 Chat2API 映射', async () => {
    const { service, profile, runtime, saves } = setup('Qwen3.6-Flash');
    runtime.modelMapper = { resolveModel: () => { throw new Error('不应读取模型映射'); } };
    for (const [name, providerId, tier] of [
        ['Qwen3.6-Flash', 'qwen', 'mini'], ['Qwen3.7', 'qwen', 'flash'],
        ['Qwen3.7-Max', 'qwen', 'pro'], ['doubao', 'doubaochat', 'mini'],
        ['doubao-think', 'doubaochat', 'flash'], ['doubao-expert', 'doubaochat', 'pro'],
        ['aasc-qwen-mini', 'qwen', 'mini']
    ]) assert.deepEqual(identifyModel(name), { providerId, tier });
    assert.deepEqual(identifyModel('doubao', { doubaochat: 'flash' }), { providerId: 'doubaochat', tier: 'mini' });
    assert.deepEqual(identifyModel('doubao-think'), { providerId: 'doubaochat', tier: 'flash' });
    assert.equal(service.selection().providerId, 'qwen');
    assert.equal(service.selection().tiersByProvider.qwen, 'mini');
    assert.equal((await service.resolveForChat()).model, 'aasc-qwen-mini');
    await service.update({ providerId: 'doubaochat' });
    assert.equal(saves.at(-1).preference.tiersByProvider.qwen, 'mini');
    profile.model = 'doubao-think';
    assert.equal(service.selection().tiersByProvider.doubaochat, 'flash');
    assert.equal((await service.resolveForChat()).model, 'doubao-think');
    await service.update({ providerId: 'doubaochat', tier: 'flash' });
    assert.equal(profile.model, 'doubao-think');
    profile.model = 'unknown-model';
    assert.equal(service.selection().providerId, null);
    assert.equal(await service.resolveForChat(), null);
    profile.mode = 'agent';
    profile.model = 'doubao';
    assert.equal(service.selection().providerId, null);
    await assert.rejects(service.update({ providerId: 'qwen', tier: 'flash' }), /不是普通 LLM/);
});

test('豆包轻量和普通保留不同名称，按当前名称回显档位', async () => {
    const { service, profile, saves, requests } = setup();
    await service.update({ providerId: 'doubaochat', tier: 'flash' });
    assert.equal(profile.model, 'doubao-think');
    assert.equal(service.selection().tiersByProvider.doubaochat, 'flash');
    assert.equal((await service.resolveForChat()).model, 'doubao-think');
    await (await service.resolveForChat()).client.request({ input: '早' });
    assert.equal(requests.at(-1).model, 'doubao-think');
    await service.update({ providerId: 'doubaochat', tier: 'mini' });
    assert.equal(profile.model, 'doubao');
    assert.equal(service.selection().tiersByProvider.doubaochat, 'mini');
    assert.equal(saves.at(-1).preference.tiersByProvider.doubaochat, 'mini');
    await service.update({ providerId: 'doubaochat', tier: 'flash' });
    assert.equal(profile.model, 'doubao-think');
    assert.equal(service.selection().tiersByProvider.doubaochat, 'flash');
});

test('停用账号不能选用，旧选择也不会回退到其它 Provider', async () => {
    const { service, runtime } = setup();
    await assert.rejects(service.update({ providerId: 'deepseek', tier: 'mini' }), /没有三档映射/);
    await assert.rejects(service.update({ providerId: 'qwen', tier: 'unknown' }), /档位不合法/);
    await service.update({ providerId: 'qwen' });
    runtime.dataStore.listAccounts = async () => [{ providerId: 'qwen', enabled: false }];
    await assert.rejects(service.resolveForChat(), /未登录或不可用/);
    assert.equal(service.selection().providerId, 'qwen');
});

test('三档请求使用对应模型并保留服务端 Responses 续接参数', async () => {
    const { service, requests } = setup();
    await service.update({ providerId: 'qwen', tier: 'mini' });
    const mini = await service.resolveForChat();
    assert.equal(mini.model, 'aasc-qwen-mini');
    assert.deepEqual(await mini.client.request({ input: '你好', previous_response_id: 'resp_a' }), { output_text: 'ok' });
    assert.equal(requests[0].previous_response_id, 'resp_a');
    assert.equal(requests[0].model, 'aasc-qwen-mini');
    await service.update({ providerId: 'doubaochat', tier: 'pro' });
    const pro = await service.resolveForChat();
    const events = [];
    await pro.client.stream({ input: '继续' }, event => events.push(event));
    assert.equal(requests[1].model, 'doubao-expert');
    assert.deepEqual(events.map(event => event.type), ['response.output_text.delta', 'response.completed']);
});

test('流式上游失败与提前结束不能被当成成功回复', async () => {
    const { service, runtime } = setup();
    await service.update({ providerId: 'doubaochat' });
    const client = (await service.resolveForChat()).client;
    runtime.responsesService.createResponse = async () => ({ stream: (async function* () {
        yield { type: 'response.failed', error: { code: 'doubao_risk_control',
            statusCode: 403, message: '请在官网处理安全验证' } };
    }()) });
    await assert.rejects(client.stream({ input: '你好' }, () => {}), error => error.code === 'doubao_risk_control');
    runtime.responsesService.createResponse = async () => ({ stream: (async function* () {
        yield { type: 'response.output_text.delta', delta: '半轮' };
    }()) });
    await assert.rejects(client.stream({ input: '你好' }, () => {}), error => error.code === 'responses_stream_interrupted');
});
