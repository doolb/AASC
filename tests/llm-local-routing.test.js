'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
    LlmModelManifestService
} = require('../src/apps/server/modules/llm/llm-model-manifest-service');
const {
    LlmRouter
} = require('../src/apps/server/modules/llm/llm-router');
const {
    LlmGatewayService
} = require('../src/apps/server/modules/llm/llm-gateway-service');
const config = require('../src/apps/server/modules/config/config-app-service');

function createTempManifest() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-llm-'));
    const modelDir = path.join(root, 'qwen-test');
    const modelFile = path.join(modelDir, 'weights.mnn');
    const content = Buffer.from('test-mnn-model');
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(modelFile, content);
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
        models: [{
            modelId: 'qwen-test',
            displayName: '测试模型',
            aliases: ['external-qwen'],
            architecture: 'qwen',
            revision: 'test-revision',
            files: [{
                name: 'weights.mnn',
                size: content.length,
                sha256: crypto.createHash('sha256').update(content).digest('hex')
            }]
        }]
    }));
    return root;
}

test('LLM 模型清单只暴露完整且 hash 正确的文件', () => {
    const modelRoot = createTempManifest();
    const service = new LlmModelManifestService({ modelRoot, clock: () => 123 });
    const manifest = service.createManifest();
    assert.equal(manifest.models.length, 1);
    assert.equal(manifest.models[0].modelId, 'qwen-test');
    assert.equal(manifest.models[0].ready, true);
    assert.deepEqual(manifest.models[0].aliases, ['external-qwen']);
    assert.equal(service.resolveModelId('external-qwen'), 'qwen-test');
    assert.equal(service.resolveModelId('qwen-test'), 'qwen-test');
    assert.equal(manifest.generatedAt, 123);
    assert.equal(path.basename(service.resolveFile('qwen-test', 'weights.mnn')), 'weights.mnn');
    assert.throws(
        () => service.resolveFile('qwen-test', '../manifest.json'),
        (error) => error.code === 'MODEL_INVALID_FILE'
    );
});

test('ModelScope 远端清单提供固定仓库和逐文件校验信息', () => {
    // 使用只含清单的临时目录，避免本地已下载模型缓存改变 ready 断言。
    const modelRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-llm-remote-'));
    fs.copyFileSync(
        path.resolve(__dirname, '..', 'res/models/llm/manifest.json'),
        path.join(modelRoot, 'manifest.json')
    );
    const service = new LlmModelManifestService({
        modelRoot
    });
    const manifest = service.createManifest();
    assert.ok(manifest.models.length >= 5);
    const model = manifest.models.find((item) => item.modelId === 'minicpm4-0.5b-mnn');
    assert.equal(model.source.provider, 'modelscope');
    assert.equal(model.source.repository, 'MNN/MiniCPM4-0.5B-MNN');
    assert.equal(model.ready, false);
    assert.ok(model.files.every((file) => file.cached === false));
    assert.ok(model.files.every((file) => file.size > 0 && /^[0-9a-f]{64}$/u.test(file.sha256)));
    const source = service.resolveRemoteDownload(model.modelId, 'config.json');
    assert.equal(source.type, 'remote');
    assert.match(source.url, /modelscope\.cn\/models\/MNN\/MiniCPM4-0\.5B-MNN\/resolve\//u);
    assert.throws(
        () => service.resolveDownload(model.modelId, 'config.json'),
        (error) => error.code === 'MODEL_NOT_READY'
    );
    const visionModel = manifest.models.find((item) => item.modelId === 'qwen3.5-0.8b-claude-opus-distilled-mnn');
    assert.equal(visionModel.source.provider, 'modelscope');
    assert.equal(visionModel.source.repository, 'MNN/Qwen3.5-0.8B-Claude-4.6-Opus-Reasoning-Distilled-MNN');
    assert.equal(visionModel.source.revision, 'c1bc31b15286afa708f37f690099d10f21d1cc74');
    assert.equal(visionModel.multimodal, true);
    assert.deepEqual(visionModel.aliases, [
        'qwen3.5',
        'Qwen3.5-0.8B-Claude-4.6-Opus-Reasoning-Distilled-MNN'
    ]);
    assert.equal(visionModel.ready, false);
    assert.equal(visionModel.totalBytes, 544130168);
    assert.deepEqual(visionModel.files.map((file) => file.name), [
        'config.json',
        'configuration.json',
        'llm.mnn',
        'llm.mnn.json',
        'llm.mnn.weight',
        'llm_config.json',
        'tokenizer.txt',
        'visual.mnn',
        'visual.mnn.weight'
    ]);
    const visionSource = service.resolveRemoteDownload(visionModel.modelId, 'visual.mnn');
    assert.match(visionSource.url, /MNN\/Qwen3\.5-0\.8B-Claude-4\.6-Opus-Reasoning-Distilled-MNN\/resolve\/c1bc31b15286afa708f37f690099d10f21d1cc74\/visual\.mnn$/u);
});

test('LLM 路由按 activeRequests + queueDepth 选择最短队列', () => {
    const router = new LlmRouter({ maxQueueLength: 1 });
    router.registerDisplay('display-b', {
        supported: true,
        ready: true,
        selectedModelId: 'qwen-test'
    });
    router.registerDisplay('display-a', {
        supported: true,
        ready: true,
        selectedModelId: 'qwen-test'
    });
    const first = router.acquire('request-1', { modelId: 'qwen-test' });
    assert.equal(first.displayId, 'display-a');
    router.markActive('request-1');
    const second = router.acquire('request-2', { modelId: 'qwen-test' });
    assert.equal(second.displayId, 'display-b');
    assert.throws(
        () => router.resolveTarget({ modelId: 'qwen-test', displayId: 'display-a' }),
        (error) => error.code === 'LLM_QUEUE_FULL'
    );
    router.release('request-1');
    router.release('request-2');
});

test('显式 displayId 不可用时不改派到其他显示端', () => {
    const router = new LlmRouter();
    router.registerDisplay('display-a', {
        supported: true,
        ready: true,
        selectedModelId: 'qwen-test'
    });
    assert.throws(
        () => router.resolveTarget({ modelId: 'qwen-test', displayId: 'display-missing' }),
        (error) => error.code === 'LLM_TARGET_UNAVAILABLE' && error.displayId === 'display-missing'
    );
});

test('关闭 LLM 能力的显示端不进入路由池', () => {
    const router = new LlmRouter();
    router.registerDisplay('display-disabled', {
        capabilities: { llm: { enabled: false, supported: true } },
        supported: true,
        ready: true,
        selectedModelId: 'qwen-test'
    });
    const status = router.getDisplayStatus('display-disabled');
    assert.equal(status.enabled, false);
    assert.equal(status.supported, false);
    assert.throws(
        () => router.resolveTarget({ modelId: 'qwen-test', displayId: 'display-disabled' }),
        (error) => error.code === 'LLM_TARGET_UNAVAILABLE'
    );
});

test('LLM 状态解包后保留下载和错误状态', () => {
    const router = new LlmRouter();
    const gateway = new LlmGatewayService({
        modelManifestService: { createManifest: () => ({ models: [] }) },
        router,
        sendToDisplay: () => true
    });
    gateway.handleDisplayMessage('display-a', {
        type: 'llm.status',
        status: {
            supported: true,
            state: 'downloading',
            ready: false,
            selectedModelId: 'qwen-test',
            error: null
        }
    });
    assert.deepEqual(router.getDisplayStatus('display-a'), {
        displayId: 'display-a',
        state: 'downloading',
        connected: true,
        enabled: true,
        supported: true,
        ready: false,
        selectedModelId: 'qwen-test',
        selectedRevision: null,
        loadedModelId: 'qwen-test',
        loadedRevision: null,
        threadCount: null,
        loadedThreadCount: null,
        activeRequests: 0,
        queueDepth: 0,
        error: null
    });
});

test('实际加载模型与选中模型不一致时不进入路由池', () => {
    const router = new LlmRouter();
    router.registerDisplay('display-a', {
        supported: true,
        ready: true,
        selectedModelId: 'qwen-test',
        loadedModelId: 'other-model'
    });
    const status = router.getDisplayStatus('display-a');
    assert.equal(status.ready, false);
    assert.equal(status.loadedModelId, 'other-model');
    assert.throws(
        () => router.resolveTarget({ modelId: 'qwen-test' }),
        (error) => error.code === 'LLM_TARGET_UNAVAILABLE'
    );
});

test('LLM 网关将显示端 chunk 聚合成请求结果并释放路由计数', async () => {
    const router = new LlmRouter();
    router.registerDisplay('display-a', {
        supported: true,
        ready: true,
        selectedModelId: 'qwen-test'
    });
    const sent = [];
    const gateway = new LlmGatewayService({
        modelManifestService: {
            resolveModelId: (modelName) => modelName,
            createManifest: () => ({ models: [{ modelId: 'qwen-test', displayName: '测试模型', ready: true }] })
        },
        router,
        sendToDisplay: (displayId, message) => {
            sent.push({ displayId, message });
            return true;
        },
        requestTimeoutMs: 1000
    });
    const request = gateway.validateRequest('chat.completions', {
        model: 'qwen-test',
        messages: [{ role: 'user', content: '你好' }],
        stream: true
    });
    const started = gateway.startRequest(request);
    gateway.handleDisplayMessage('display-a', {
        type: 'llm.chunk',
        requestId: request.requestId,
        text: '你好'
    });
    gateway.handleDisplayMessage('display-a', {
        type: 'llm.chunk',
        requestId: request.requestId,
        text: '，世界'
    });
    gateway.handleDisplayMessage('display-a', {
        type: 'llm.completed',
        requestId: request.requestId,
        finishReason: 'stop'
    });
    const result = await started.promise;
    assert.equal(result.text, '你好，世界');
    assert.equal(sent[0].message.type, 'llm.request');
    assert.equal(router.getRequest(request.requestId), null);
});

test('LLM 网关空闲超时会发送 llm.cancel 并释放路由', async () => {
    const router = new LlmRouter();
    router.registerDisplay('display-a', {
        supported: true,
        ready: true,
        selectedModelId: 'qwen-test'
    });
    const sent = [];
    const gateway = new LlmGatewayService({
        modelManifestService: {
            resolveModelId: (modelName) => modelName,
            createManifest: () => ({ models: [{ modelId: 'qwen-test', ready: true }] })
        },
        router,
        sendToDisplay: (displayId, message) => {
            sent.push({ displayId, message });
            return true;
        },
        requestTimeoutMs: 30
    });
    const request = gateway.validateRequest('chat.completions', {
        model: 'qwen-test',
        messages: [{ role: 'user', content: '等待超时' }]
    });
    const started = gateway.startRequest(request);
    await assert.rejects(started.promise, (error) => error.code === 'LLM_REQUEST_TIMEOUT');
    assert.deepEqual(sent.map((item) => item.message.type), ['llm.request', 'llm.cancel']);
    assert.equal(sent[1].message.requestId, request.requestId);
    assert.equal(router.getRequest(request.requestId), null);
});

test('LLM 网关收到 chunk 后续期空闲超时', async () => {
    const router = new LlmRouter();
    router.registerDisplay('display-a', {
        supported: true,
        ready: true,
        selectedModelId: 'qwen-test'
    });
    const sent = [];
    const gateway = new LlmGatewayService({
        modelManifestService: {
            resolveModelId: (modelName) => modelName,
            createManifest: () => ({ models: [{ modelId: 'qwen-test', ready: true }] })
        },
        router,
        sendToDisplay: (displayId, message) => {
            sent.push({ displayId, message });
            return true;
        },
        requestTimeoutMs: 100
    });
    const request = gateway.validateRequest('chat.completions', {
        model: 'qwen-test',
        messages: [{ role: 'user', content: '持续生成' }]
    });
    const started = gateway.startRequest(request);
    await new Promise((resolve) => setTimeout(resolve, 60));
    gateway.handleDisplayMessage('display-a', {
        type: 'llm.chunk',
        requestId: request.requestId,
        text: '仍在生成'
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.notEqual(router.getRequest(request.requestId), null);
    gateway.handleDisplayMessage('display-a', {
        type: 'llm.completed',
        requestId: request.requestId,
        text: '完成'
    });
    const result = await started.promise;
    assert.equal(result.text, '完成');
    assert.deepEqual(sent.map((item) => item.message.type), ['llm.request']);
});

test('LLM 网关把外部模型名映射为内部 modelId 后再路由', () => {
    const router = new LlmRouter();
    router.registerDisplay('display-a', {
        supported: true,
        ready: true,
        selectedModelId: 'qwen-test'
    });
    const sent = [];
    const gateway = new LlmGatewayService({
        modelManifestService: {
            resolveModelId: (modelName) => ['external-qwen', 'qwen-test'].includes(modelName)
                ? 'qwen-test'
                : null,
            createManifest: () => ({ models: [{ modelId: 'qwen-test', ready: true }] })
        },
        router,
        sendToDisplay: (displayId, message) => {
            sent.push({ displayId, message });
            return true;
        },
        requestTimeoutMs: 1000
    });
    const request = gateway.validateRequest('chat.completions', {
        model: 'external-qwen',
        messages: [{ role: 'user', content: '你好' }]
    });
    assert.equal(request.requestedModelId, 'external-qwen');
    assert.equal(request.modelId, 'qwen-test');
    assert.equal(request.payload.model, 'qwen-test');
    const started = gateway.startRequest(request);
    assert.equal(sent[0].message.modelId, 'qwen-test');
    gateway.handleDisplayMessage('display-a', {
        type: 'llm.completed',
        requestId: started.requestId,
        text: '好的'
    });
    return started.promise.then((result) => assert.equal(result.text, '好的'));
});

test('LLM 网关在 manifest 未命中时使用动态默认模型映射', () => {
    const router = new LlmRouter();
    router.registerDisplay('display-a', {
        supported: true,
        ready: true,
        selectedModelId: 'qwen-test'
    });
    const gateway = new LlmGatewayService({
        modelManifestService: {
            resolveModelId: (modelName) => modelName === 'qwen-test' ? 'qwen-test' : null,
            createManifest: () => ({ models: [{ modelId: 'qwen-test', ready: true }] })
        },
        router,
        sendToDisplay: () => true,
        getDefaultModelMappings: () => [{
            externalModelName: 'local-chat',
            modelId: 'qwen-test'
        }]
    });

    const request = gateway.validateRequest('chat.completions', {
        model: 'local-chat',
        messages: [{ role: 'user', content: '你好' }]
    });

    assert.equal(request.requestedModelId, 'local-chat');
    assert.equal(request.modelId, 'qwen-test');
    assert.equal(request.payload.model, 'qwen-test');
});

test('LLM 默认模型映射配置缺失时回落为空数组', () => {
    assert.deepEqual(config.get('llm.defaultModelMappings'), []);
});

test('LLM 默认模型映射保存前会清理空行和首尾空格', () => {
    assert.equal(typeof config.normalizeLlmDefaultModelMappings, 'function');
    const result = config.normalizeLlmDefaultModelMappings([
        { externalModelName: ' local-chat ', modelId: ' qwen-test ' },
        { externalModelName: ' ', modelId: ' ' },
        { externalModelName: 'vision', modelId: 'qwen-vl' }
    ], ['qwen-test', 'qwen-vl']);

    assert.deepEqual(result, {
        ok: true,
        value: [
            { externalModelName: 'local-chat', modelId: 'qwen-test' },
            { externalModelName: 'vision', modelId: 'qwen-vl' }
        ]
    });
});

test('LLM 默认模型映射拒绝重复外部名和未知内部模型', () => {
    assert.equal(typeof config.normalizeLlmDefaultModelMappings, 'function');
    const duplicate = config.normalizeLlmDefaultModelMappings([
        { externalModelName: 'chat', modelId: 'qwen-test' },
        { externalModelName: 'chat', modelId: 'qwen-vl' }
    ], ['qwen-test', 'qwen-vl']);
    const unknown = config.normalizeLlmDefaultModelMappings([
        { externalModelName: 'chat', modelId: 'missing-model' }
    ], ['qwen-test']);

    assert.equal(duplicate.ok, false);
    assert.match(duplicate.message, /外部模型名重复/u);
    assert.equal(unknown.ok, false);
    assert.match(unknown.message, /内部模型不存在/u);
});

test('LLM 默认模型映射限制条目数量和名称长度', () => {
    const tooMany = config.normalizeLlmDefaultModelMappings(
        Array.from({ length: 65 }, (_, index) => ({
            externalModelName: `chat-${index}`,
            modelId: 'qwen-test'
        })),
        ['qwen-test']
    );
    const tooLong = config.normalizeLlmDefaultModelMappings([
        { externalModelName: 'x'.repeat(257), modelId: 'qwen-test' }
    ], ['qwen-test']);

    assert.equal(tooMany.ok, false);
    assert.match(tooMany.message, /最多支持 64 条/u);
    assert.equal(tooLong.ok, false);
    assert.match(tooLong.message, /不能超过 256/u);
});

test('LLM 模型别名冲突时拒绝清单', () => {
    const modelRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-llm-alias-conflict-'));
    fs.writeFileSync(path.join(modelRoot, 'manifest.json'), JSON.stringify({
        models: [
            { modelId: 'model-a', aliases: ['shared'], files: [{ name: 'a.mnn', size: 1, sha256: 'a'.repeat(64) }] },
            { modelId: 'model-b', aliases: ['shared'], files: [{ name: 'b.mnn', size: 1, sha256: 'b'.repeat(64) }] }
        ]
    }));
    const service = new LlmModelManifestService({ modelRoot });
    assert.throws(
        () => service.createManifest(),
        (error) => error.code === 'MODEL_ALIAS_CONFLICT'
    );
});
