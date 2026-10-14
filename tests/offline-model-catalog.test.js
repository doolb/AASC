'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const common = require('../scripts/models/ai-model-common');
const { REMOTE_SCRIPT } = require('../scripts/models/publish-ai-models');
const { validateCatalog, readOfflineModelCatalog } = require('../scripts/models/offline-model-catalog');
const catalog = require('../src/apps/server/modules/model-distribution/offline-model-catalog.json');
const { LlmModelManifestService } = require('../src/apps/server/modules/llm/llm-model-manifest-service');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-declared-models-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

async function write(root, name, bytes) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), bytes);
}

test('可信目录保留5种LLM定义及声纹/ASR/TTS，非法路径和重复文件被拒绝', async () => {
    const trusted = await readOfflineModelCatalog(path.resolve(__dirname, '..'));
    assert.equal(trusted.models.length, 8);
    const qwen = trusted.models.find(model => model.modelId.startsWith('qwen3.5-'));
    assert.equal(qwen.files.length, 9);
    assert.equal(qwen.totalBytes, 544130168);
    for (const change of [model => { model.files[0].path = 'llm/../escape'; },
        model => { model.files.push(model.files[0]); }, model => { model.totalBytes++; }]) {
        const corrupt = structuredClone(trusted); change(corrupt.models[0]);
        assert.throws(() => validateCatalog(corrupt));
    }
});

test('无LLM资源的Offline服务仍可枚举定义，但不把未下载模型报ready', async t => {
    const root = await fixture(t);
    const previous = process.env.AASC_OFFLINE_MODE;
    try {
        process.env.AASC_OFFLINE_MODE = '1';
        const service = new LlmModelManifestService({ modelRoot: root });
        const result = service.createManifest();
        assert.equal(result.models.length, 5);
        assert.ok(result.models.every(model => model.ready === false));
        assert.deepEqual(await fs.readdir(root), []);
    } finally {
        if (previous === undefined) delete process.env.AASC_OFFLINE_MODE;
        else process.env.AASC_OFFLINE_MODE = previous;
    }
});

test('控制端模型自测只读状态，不触发模型准备或原生加载', async () => {
    const source = await fs.readFile(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/self-test.js'), 'utf8');
    let reads = 0;
    const valid = { modelId: 'tts', revision: 'r', totalBytes: 1, filesPresent: true, filesReady: false, downloading: false };
    const bridge = { status() { reads++; return JSON.stringify([valid]); }, prepare() { throw new Error('不应下载'); } };
    const expression = source + '\nSelfTest.tests.find(test => test.id === "offline_native_models").run();';
    const result = await vm.runInNewContext(expression, { window: { NativeOfflineModels: bridge } });
    assert.equal(result.success, true);
    assert.equal(reads, 1);
    const invalid = await vm.runInNewContext(expression, { window: { NativeOfflineModels: {
        status: () => JSON.stringify([valid, valid])
    } } });
    assert.equal(invalid.success, false);
});

test('声明收集完整TTS/Qwen文件，缺失模型只保留定义、排除缓存与脚本', async t => {
    const root = await fixture(t);
    const tts = catalog.models.find(model => model.modelId === 'tts');
    const declarations = [];
    for (const file of tts.files) {
        const bytes = Buffer.from(file.name);
        await write(root, file.path, bytes);
        declarations.push({ name: file.name, sha256: hash(bytes) });
    }
    await write(root, 'tts/manifest.json', JSON.stringify(declarations));
    const file = { name: 'llm.mnn.weight', size: 3, sha256: hash('abc') };
    await write(root, 'llm/qwen-test/llm.mnn.weight', 'abc');
    await write(root, 'llm/manifest.json', JSON.stringify({ models: [
        { modelId: 'qwen-test', directory: 'qwen-test', files: [file] },
        { modelId: 'absent-test', directory: 'absent-test', files: [file] }
    ] }));
    await write(root, 'llm/qwen-test/.manifest.json', 'cache');
    await write(root, 'llm/qwen-test/debug.js', 'script');
    const manifest = await common.collectModels(root);
    assert.equal(manifest.files.length, 17);
    assert.ok(manifest.files.some(file => file.path === 'llm/qwen-test/llm.mnn.weight'));
    assert.ok(manifest.files.every(file => !file.path.includes('absent-test') && !file.path.endsWith('.js') && !file.path.includes('/.')));
    await fs.unlink(path.join(root, 'tts', tts.files[0].name));
    await assert.rejects(common.collectModels(root));
});

test('LLM已存在目录缺必要文件或hash错误时阻止发布，不能降为零散文件', async t => {
    const root = await fixture(t);
    const model = { modelId: 'qwen-test', directory: 'qwen-test', files: [
        { name: 'llm.mnn.weight', size: 3, sha256: hash('abc') }
    ] };
    await write(root, 'llm/manifest.json', JSON.stringify({ models: [model] }));
    await fs.mkdir(path.join(root, 'llm/qwen-test'));
    await assert.rejects(common.collectModels(root));
    await write(root, 'llm/qwen-test/llm.mnn.weight', 'bad');
    await assert.rejects(common.collectModels(root), /校验失败/u);
});

test('远端Python与本地规则同时接受合法三段LLM与TTS，拒绝未知子目录', async t => {
    const parent = await fixture(t);
    const files = ['tts/MSTTSLocZhCN.dat', 'llm/qwen-test/llm.mnn.weight'].map(name => ({ path: name, size: 1, sha256: hash('x') }));
    const manifest = common.validateManifest({ schemaVersion: 1, files, totalBytes: 2 });
    const payload = { root: path.join(parent, 'remote'), manifest, operation: 'probe',
        manifestBytes: common.manifestBytes(manifest).toString('base64') };
    const result = await execute('python3', ['-c', REMOTE_SCRIPT, Buffer.from(JSON.stringify(payload)).toString('base64')]);
    assert.ok(JSON.parse(result.stdout).stage);
    for (const illegal of ['llm/qwen-test/debug.js', 'llm/qwen-test/sub/llm.mnn', 'tts/evil.dat', 'llm/../llm.mnn']) {
        assert.equal(common.allowedPath(illegal), false);
        const bad = { ...payload, manifest: { ...manifest, files: [{ ...files[0], path: illegal }], totalBytes: 1 } };
        bad.manifestBytes = Buffer.from(JSON.stringify(bad.manifest)).toString('base64');
        await assert.rejects(execute('python3', ['-c', REMOTE_SCRIPT, Buffer.from(JSON.stringify(bad)).toString('base64')]));
    }
});
