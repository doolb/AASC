'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMotionModelService } = require('../src/apps/server/modules/sub-ai/motion-model-service');
const { createMotionCoordinator } = require('../src/apps/server/modules/sub-ai/motion-coordinator');
const { createSubAiChatBridge } = require('../src/apps/server/modules/sub-ai/sub-ai-chat-bridge');
const source = '@pose rest {\n head reset;\n}\n@pose nod {\n head bend forward 12;\n}\n@animation gesture {\n 0: rest;\n 0.5: nod;\n 1: rest;\n}\nmain {\n gesture;\n}';
const artifact = { source, providerId: 'qwen', model: 'test-model' };
function modelFixture() {
    const values = new Map(), calls = [];
    const runtime = { getStatus: () => ({ running: true }), dataStore: {
        listAccounts: async () => [{ providerId: 'qwen', enabled: true }], readCollection: async () => [] },
    providerRegistry: { listProviders: async () => [{ id: 'qwen', supportedModels: ['test-model', 'audio-tts'] }] },
    modelMapper: { resolveModel: async () => ({}) }, coreAdapter: { async forwardChatCompletion(body, options) {
        calls.push({ body, options }); return { body: { choices: [{ message: { content: JSON.stringify({ status: 'ok', source }) } }] } };
    } } };
    const config = { get: key => values.get(key), set: (key, value) => { values.set(key, value); return true; } };
    return { service: createMotionModelService({ config, getRuntime: () => runtime }), values, runtime, calls, config };
}
test('动作Provider/具体模型与主AI隔离，revision冲突及错误绑定拒绝', async () => {
    const { service, values, runtime, calls } = modelFixture();
    assert.equal(service.selection().enabled, false);
    assert.ok(!(await service.providers())[0].models.some(m => m.id === 'audio-tts'));
    const revision = service.revision();
    await service.update({ revision, enabled: true, providerId: 'qwen', model: 'test-model' });
    await assert.rejects(service.update({ revision, enabled: false, providerId: 'qwen', model: 'test-model' }), /变化/);
    const signal = new AbortController().signal;
    assert.equal((await service.generate({ description: '点头', capabilities: {} }, { signal })).source, source);
    assert.equal(calls[0].options.preferredProviderId, 'qwen'); assert.equal(calls[0].options.signal, signal);
    assert.equal(calls[0].body.stream, false); assert.equal(calls[0].body.messages.length, 2);
    assert.equal(calls[0].body.previous_response_id, undefined);
    assert.deepEqual([...values.keys()], ['chat.subAi.motion']);
    runtime.modelMapper.resolveModel = async () => ({ preferredProviderId: 'glm' });
    await assert.rejects(service.generate({ description: '点头', capabilities: {} }), /其他Provider/);
});
test('动作模型关闭、持久化失败和非法生成结果明确报错', async () => {
    const { service, runtime, config } = modelFixture();
    await assert.rejects(service.generate({ description: 'x' }), /未启用/);
    config.set = () => false;
    await assert.rejects(service.update({ revision: service.revision(), enabled: true, providerId: 'qwen', model: 'test-model' }), /保存失败/);
    const settings = { enabled: true, providerId: 'qwen', model: 'test-model' };
    runtime.coreAdapter.forwardChatCompletion = async () => ({ body: { choices: [{ message: { content: 'not json' } }] } });
    await assert.rejects(service.generate({ description: 'x' }, { settings }), SyntaxError);
});
function coordinatorFixture(options = {}) {
    const sent = [], published = [], generated = [];
    const service = createMotionCoordinator({ models: { selection: () => ({ enabled: true }), generate: async input => { generated.push(input); return artifact; } },
        send: (displayId, message) => sent.push({ displayId, ...message }), publish: m => published.push(m), ...options });
    const catalog = id => service.handle(id, { type: 'chatAction', op: 'catalog', catalog: { key: 'model:1', ready: true,
        actions: ['本地动作'], capabilities: { bones: [] } } });
    const call = (id = 'd') => { service.begin(id, 'turn'); service.request(id, 'turn', { task: '动作', prompt: '本地动作' }); return sent.at(-1).requestId; };
    const ack = (requestId, op, extra = {}, id = 'd') => service.handle(id, { type: 'chatAction', op, requestId, key: 'model:1', ...extra });
    return { service, sent, published, generated, catalog, call, ack };
}
test('本地动作命中零SubAI调用，回执必须绑定目标/阶段并且只开始一次', async t => {
    const f = coordinatorFixture(); t.after(() => f.service.dispose()); await f.catalog('d'); const id = f.call();
    await f.ack(id, 'ready', { ticketId: 'ticket', duration: 1 }, 'other'); assert.equal(f.sent.length, 1);
    await f.ack(id, 'ready', { ticketId: 'ticket', duration: 1 });
    await f.ack(id, 'ready', { ticketId: 'ticket', duration: 1 });
    assert.equal(f.sent.filter(m => m.op === 'start').length, 1); assert.equal(f.generated.length, 0);
    await f.ack(id, 'result', { status: 'completed' }); assert.equal(f.published.at(-1).state, 'completed');
});
test('缺库生成、一次编译反馈修复、再失败停止，主聊天不被调用', async t => {
    const f = coordinatorFixture(); t.after(() => f.service.dispose()); await f.catalog('d'); const id = f.call();
    await f.ack(id, 'missing'); assert.equal(f.generated.length, 1); assert.equal(f.sent.at(-1).op, 'prepare');
    await f.ack(id, 'invalid', { message: '骨骼缺失' }); assert.equal(f.generated.length, 2);
    assert.equal(f.generated[1].diagnostic, '骨骼缺失'); assert.equal(f.generated[1].source, source);
    await f.ack(id, 'invalid', { message: '仍无效' }); assert.equal(f.generated.length, 2); assert.equal(f.published.at(-1).state, 'failed');
});
test('模型变化或新轮次后，迟到生成/ready/start不能复活动作', async t => {
    let release;
    const f = coordinatorFixture({ models: { selection: () => ({ enabled: true }), generate: () => new Promise(r => { release = r; }) } });
    t.after(() => f.service.dispose()); await f.catalog('d'); const id = f.call();
    const work = f.ack(id, 'missing'); f.service.begin('d', 'new-turn'); release(artifact); await work;
    await f.ack(id, 'ready', { ticketId: 'late', duration: 1 });
    assert.equal(f.sent.filter(m => ['prepare', 'start'].includes(m.op)).length, 0);
});
test('动作准备超时取消当前任务，不占用后续显示端请求', async t => {
    const f = coordinatorFixture({ timeoutMs: 20 }); t.after(() => f.service.dispose()); await f.catalog('d'); f.call();
    await new Promise(r => setTimeout(r, 40));
    assert.equal(f.published.at(-1).state, 'failed'); assert.match(f.published.at(-1).message, /超时/);
    assert.equal(f.sent.at(-1).op, 'cancel');
});
test('SubAI动作CSV复用真实流式桥，不泄露指令到正文或TTS', async () => {
    const calls = [], sentences = []; let prompt;
    const text = '好的。\nSubAI,动作,"右手举起,慢慢挥两下"';
    const bridge = createSubAiChatBridge({ async chatStream(content, options, callbacks) {
        prompt = options.systemPrompt;
        for (let i = 1; i <= text.length; i++) callbacks.onChunk(text[i - 1], text.slice(0, i), '');
        return { success: true, message: text };
    } }, { motionPrompt: '角色支持动作', dispatch: async call => calls.push(call) });
    const result = await bridge.chatStream('举手', {}, { onSentence: text => sentences.push(text) });
    assert.match(prompt, /角色支持动作/); assert.equal(calls.length, 1); assert.equal(calls[0].task, '动作');
    assert.equal(calls[0].prompt, '右手举起,慢慢挥两下'); assert.doesNotMatch(result.message, /SubAI/);
    assert.doesNotMatch(sentences.join(''), /SubAI|慢慢/);
});
test('schema1迁移保留默认版本，候选导入导出及配额校验', async () => {
    const storage = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-storage.mjs');
    const old = { schema: 1, actions: [{ actionId: '已登记', active: 'v1', versions: [{ id: 'v1', source }] }],
        assets: [], rules: [], presets: {}, mappings: {}, physiology: {} };
    const migrated = storage.validateHumanLibrary(old); assert.equal(old.schema, 1); assert.equal(migrated.schema, 2);
    const candidate = { id: 'c1', requestId: 'job', description: '点头', ...artifact };
    migrated.candidates.push(candidate);
    const restored = await storage.importHumanLibrary(storage.exportHumanLibrary(migrated));
    assert.equal(restored.actions[0].active, 'v1'); assert.deepEqual(restored.candidates, [candidate]);
    assert.throws(() => storage.validateHumanLibrary({ ...restored, candidates: [candidate, candidate] }), /候选/);
    assert.throws(() => storage.validateHumanLibrary({ ...restored, candidates: [{ ...candidate, source: 'x'.repeat(16385) }] }), /候选/);
});
async function playerFixture() {
    const { createChatActionPlayer } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-chat-actions.mjs');
    const sent = [], saved = []; let key = 'model:1', completed = false, started = 0;
    const human = { actionKey: () => key, getState: () => ({ ready: true, actions: [{ actionId: '本地动作' }], layers: [] }),
        serverActions: { load: async () => [] }, learn: { list: () => [{ actionId: '本地动作' }] },
        capabilities: () => ({ bones: [], morphs: [], bindings: {} }), stop() {},
        prepare: async () => ({ duration: 1 }), prepareMpl: async () => ({ duration: 1 }),
        startPrepared: () => { started++; return { id: 1 }; }, getRequest: () => ({ active: !completed, completed }),
        candidates: { save: async candidate => saved.push(candidate) } };
    const player = createChatActionPlayer({ api: () => human, send: m => sent.push(m), hidden: () => false }); player.setConnected(true);
    const message = (op, extra = {}) => player.handle({ type: 'chatAction', op, requestId: 'r', key: 'model:1', deadline: Date.now() + 10000, ...extra });
    return { player, human, sent, saved, message, started: () => started, finish: () => { completed = true; }, change: () => { key = 'model:2'; } };
}
test('生成准备不播放，完整播放后才保存候选；重复start不会重播', async () => {
    const f = await playerFixture(); await f.message('resolve', { description: '未知动作' });
    assert.equal(f.sent.at(-1).op, 'missing'); await f.message('prepare', { artifact });
    assert.equal(f.started(), 0); assert.equal(f.saved.length, 0);
    const ticketId = f.sent.at(-1).ticketId;
    await f.message('start', { ticketId }); await f.message('start', { ticketId }); assert.equal(f.started(), 1);
    await f.player.tick(); assert.equal(f.saved.length, 0);
    f.finish(); await f.player.tick(); await f.player.tick(); assert.equal(f.saved.length, 1);
    assert.equal(f.sent.find(m => m.op === 'result').status, 'completed'); f.player.dispose();
});
test('准备期间模型变化与停止丢弃迟到句柄，不能入候选库', async () => {
    const f = await playerFixture(); let release;
    f.human.prepareMpl = () => new Promise(r => { release = r; });
    await f.message('resolve', { description: '未知动作' }); const work = f.message('prepare', { artifact });
    f.change(); await f.player.tick(); release({ duration: 1 }); await work;
    assert.equal(f.sent.filter(m => m.op === 'ready').length, 0); assert.equal(f.started(), 0); assert.equal(f.saved.length, 0); f.player.dispose();
});
test('自动MPL根位移、循环与超大源码拒绝，人工编译入口不受此策略影响', async () => {
    const { validateMotionSource } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-motion-policy.mjs');
    assert.equal(validateMotionSource(source), source);
    for (const invalid of ['base move 1;', 'loop 2;', 'x'.repeat(16385)]) assert.throws(() => validateMotionSource(invalid));
});

test('忽略取消的上游在超时后释放本地并发槽，迟到结果不发送', { timeout: 2000 }, async t => {
    const keepAlive = setInterval(() => {}, 100); t.after(() => clearInterval(keepAlive));
    const f = coordinatorFixture({ timeoutMs: 20, models: { selection: () => ({ enabled: true }), generate: () => new Promise(() => {}) } });
    t.after(() => f.service.dispose());
    for (const display of ['a', 'b', 'c']) {
        await f.catalog(display); const id = f.call(display);
        await f.ack(id, 'missing', {}, display);
        assert.equal(f.published.at(-1).state, 'failed'); assert.match(f.published.at(-1).message, /超时/);
    }
    assert.equal(f.sent.filter(m => m.op === 'prepare').length, 0);
});
test('已有动作参数随resolve传递，非法参数不创建任务', async t => {
    const f = coordinatorFixture(); t.after(() => f.service.dispose()); await f.catalog('d'); f.service.begin('d', 'turn');
    f.service.request('d', 'turn', { prompt: '本地动作', references: ['2', '0.7', '2'] });
    assert.deepEqual(f.sent.at(-1).parameters, { duration: 2, strength: 0.7, count: 2 });
    const before = f.sent.length;
    f.service.request('d', 'turn', { prompt: '本地动作', references: ['2', '9'] });
    assert.equal(f.sent.length, before); assert.match(f.published.at(-1).message, /超出范围/);
});
test('自动动作手动抢占或存储失败不假报已保存，失败不重复播放', async () => {
    const f = await playerFixture();
    await f.message('resolve', { description: '未知动作' }); await f.message('prepare', { artifact });
    await f.message('start', { ticketId: f.sent.at(-1).ticketId });
    f.human.candidates.save = async () => { throw new Error('磁盘满'); };
    f.finish(); await f.player.tick();
    assert.equal(f.started(), 1); assert.match(f.sent.find(m => m.op === 'result').message, /候选保存失败.*磁盘满/);
    f.player.dispose();
    const g = await playerFixture();
    await g.message('resolve', { description: '未知动作' }); await g.message('prepare', { artifact });
    g.human.getState = () => ({ ready: true, actions: [], layers: [{ owner: 'manual', priority: 100 }] });
    await g.message('start', { ticketId: g.sent.at(-1).ticketId });
    assert.equal(g.started(), 0); assert.equal(g.saved.length, 0); g.player.dispose();
});


test('手动IK接管取消自动播放、不存候选，关闭后恢复目录可用', async () => {
    const f = await playerFixture();
    await f.message('resolve', { description: '未知动作' }); await f.message('prepare', { artifact });
    await f.message('start', { ticketId: f.sent.at(-1).ticketId });
    const original = f.human.getState; let blocked = true;
    f.human.getState = () => ({ ...original(), automaticMotionBlocked: blocked });
    f.finish(); await f.player.tick();
    assert.equal(f.saved.length, 0); assert.ok(f.sent.some(m => m.op === 'result' && m.status === 'cancelled'));
    assert.equal(f.sent.at(-1).catalog.ready, false);
    blocked = false; await f.player.tick(); assert.equal(f.sent.at(-1).catalog.ready, true);
    f.player.dispose();
});
