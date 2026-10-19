'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChatModelTierService } = require('./chat-model-tier-service');

function setup() {
    let saved = null;
    const broadcasts = [];
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
        modelMapper: { async resolveModel(model) {
            const qwenModels = { 'aasc-qwen-mini': 'Qwen3.6-Flash',
                'aasc-qwen-flash': 'Qwen3.7', 'aasc-qwen-pro': 'Qwen3.7-Max' };
            return { preferredProviderId: model.startsWith('aasc-qwen-') ? 'qwen' : 'doubaochat',
                actualModel: qwenModels[model] || model };
        } },
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
        get: () => saved,
        set(_key, value) { saved = value; return true; }
    };
    return {
        runtime, requests, broadcasts,
        service: createChatModelTierService({ config, getRuntime: () => runtime,
            broadcast: message => broadcasts.push(message) })
    };
}

test('每个 Provider 记住自己的档位，Qwen 默认普通、豆包默认轻量', async () => {
    const { service, broadcasts } = setup();
    assert.deepEqual(service.selection(), {
        providerId: null, tiersByProvider: { qwen: 'flash', doubaochat: 'mini' }
    });
    assert.deepEqual((await service.availableProviders()).map(item => item.id), ['qwen', 'doubaochat']);
    await service.update({ providerId: 'qwen', tier: 'pro' });
    await service.update({ providerId: 'doubaochat' });
    assert.deepEqual(service.selection(), {
        providerId: 'doubaochat', tiersByProvider: { qwen: 'pro', doubaochat: 'mini' }
    });
    assert.equal(broadcasts.at(-1).selection.providerId, 'doubaochat');
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
