'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const common = require('../scripts/models/ai-model-common');
const { syncModels } = require('../scripts/models/sync-ai-models');

const item = (name, bytes) => ({ path: name, size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
const manifest = files => ({ schemaVersion: 1, files, totalBytes: files.reduce((sum, file) => sum + file.size, 0) });
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-ai-sync-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}
function remote(value, files, requested = []) {
    return async url => {
        const name = new URL(url).pathname.split('/aimodel/')[1];
        requested.push(name);
        return name === 'manifest.json' ? Response.json(value) : new Response(files[name] ?? '', { status: files[name] ? 200 : 404 });
    };
}

test('固定分类只收集模型和配套文件，忽略测试音频/代码，清单稳定', async t => {
    const root = await fixture(t);
    await fs.mkdir(path.join(root, 'yolo11'));
    for (const name of ['yolo11n.onnx', 'yolo11n-seg.pt', 'yolo11n.classes.json', 'README.md', 'test.wav', 'export.py']) {
        await fs.writeFile(path.join(root, 'yolo11', name), name);
    }
    const first = await common.collectModels(root), second = await common.collectModels(root);
    assert.deepEqual(first, second); assert.equal(first.files.length, 4);
    assert.ok(first.files.every(file => !file.path.endsWith('.wav') && !file.path.endsWith('.py')));
});

for (const name of ['../model.onnx', 'yolo11/../sensevoice/model.int8.onnx', '/yolo11/yolo11n.onnx',
    'yolo11\\yolo11n.onnx', 'unknown/yolo11n.onnx', 'voiceprint/tokens.txt', 'yolo11/yolo11n.onnx?query']) {
    test(`清单拒绝越界或未允许路径：${name}`, () => {
        const file = item(name, Buffer.from('x'));
        assert.throws(() => common.validateManifest(manifest([file])), /路径/u);
    });
}
test('重复路径、错误哈希、大小及总量拒绝', () => {
    const file = item('sensevoice/model.int8.onnx', Buffer.from('x'));
    for (const value of [manifest([file, file]), manifest([{ ...file, sha256: 'bad' }]),
        manifest([{ ...file, size: -1 }]), { ...manifest([file]), totalBytes: 2 }]) assert.throws(() => common.validateManifest(value));
});

test('下载正确文件后重复同步完全复用，额外文件保持', async t => {
    const root = await fixture(t), bytes = Buffer.from('模型测试'), requested = [];
    const file = item('sensevoice/model.int8.onnx', bytes), value = manifest([file]);
    await fs.mkdir(path.join(root, 'sensevoice')); await fs.writeFile(path.join(root, 'sensevoice/extra.txt'), 'keep');
    const fetchImpl = remote(value, { [file.path]: bytes }, requested);
    const first = await syncModels({ root, fetchImpl, log() {} });
    assert.deepEqual(first.downloaded, [file.path]); assert.deepEqual(await fs.readFile(path.join(root, file.path)), bytes);
    requested.length = 0;
    const second = await syncModels({ root, fetchImpl, log() {} });
    assert.deepEqual(second.reused, [file.path]); assert.deepEqual(requested, ['manifest.json']);
    assert.equal(await fs.readFile(path.join(root, 'sensevoice/extra.txt'), 'utf8'), 'keep');
});

for (const [name, body, status] of [['坏哈希', 'wrong', 200], ['截断', 'x', 200], ['超长', 'exceeds-length', 200], ['HTTP失败', 'error', 503]]) {
    test(`下载${name}保留旧模型且清理临时文件`, async t => {
        const root = await fixture(t), file = item('sensevoice/model.int8.onnx', Buffer.from('right'));
        await fs.mkdir(path.join(root, 'sensevoice')); await fs.writeFile(path.join(root, file.path), 'old');
        const fetchImpl = async url => new URL(url).pathname.endsWith('manifest.json')
            ? Response.json(manifest([file])) : new Response(body, { status });
        await assert.rejects(syncModels({ root, fetchImpl, log() {} }));
        assert.equal(await fs.readFile(path.join(root, file.path), 'utf8'), 'old');
        assert.deepEqual(await fs.readdir(path.join(root, 'sensevoice')), ['model.int8.onnx']);
    });
}

test('只下载所选分类，不触碰其他组', async t => {
    const root = await fixture(t), bytes = Buffer.from('x'), requested = [];
    const files = ['sensevoice/model.int8.onnx', 'yolo11/yolo11n.onnx'].map(name => item(name, bytes));
    const fetchImpl = remote(manifest(files), Object.fromEntries(files.map(file => [file.path, bytes])), requested);
    const report = await syncModels({ root, groups: ['sensevoice'], fetchImpl, log() {} });
    assert.deepEqual(report.downloaded, ['sensevoice/model.int8.onnx']);
    assert.deepEqual(requested, ['manifest.json', 'sensevoice/model.int8.onnx']);
    await assert.rejects(fs.stat(path.join(root, 'yolo11')), { code: 'ENOENT' });
});

test('目标文件、分类目录或模型根为符号链接时不越界写入', async t => {
    const root = await fixture(t), outside = await fixture(t), bytes = Buffer.from('x');
    await fs.writeFile(path.join(outside, 'old.onnx'), 'keep');
    const file = item('sensevoice/model.int8.onnx', bytes), fetchImpl = remote(manifest([file]), { [file.path]: bytes });
    await fs.mkdir(path.join(root, 'sensevoice'));
    await fs.symlink(path.join(outside, 'old.onnx'), path.join(root, file.path));
    await assert.rejects(syncModels({ root, fetchImpl, log() {} }), /符号链接/u);
    await fs.rm(path.join(root, file.path)); await fs.rmdir(path.join(root, 'sensevoice'));
    await fs.symlink(outside, path.join(root, 'sensevoice'), 'dir');
    await assert.rejects(syncModels({ root, fetchImpl, log() {} }), /符号链接/u);
    assert.equal(await fs.readFile(path.join(outside, 'old.onnx'), 'utf8'), 'keep');
    const linkedRoot = path.join(root, 'linked'); await fs.symlink(outside, linkedRoot, 'dir');
    await assert.rejects(common.safeFile(linkedRoot, file.path), /符号链接/u);
});

test('清单大小有上限，URL凭证/查询参数及非法CLI被拒绝', async () => {
    await assert.rejects(common.readManifest(common.SOURCE_URL, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), /过大/u);
    for (const url of ['file:///tmp/', 'https://user:pass@example.com/', 'https://example.com/?q=1']) assert.throws(() => common.normalizeSource(url));
    assert.throws(() => common.parseArgs(['--unknown', 'x'], ['root']));
    assert.throws(() => common.parseArgs(['--root'], ['root']));
    assert.equal(common.parseArgs(['--help'], []).help, true);
});

test('上传源拒绝允许文件名的符号链接或目录', async t => {
    const root = await fixture(t), outside = await fixture(t);
    await fs.writeFile(path.join(outside, 'file'), 'x'); await fs.mkdir(path.join(root, 'yolo11'));
    await fs.symlink(path.join(outside, 'file'), path.join(root, 'yolo11/yolo11n.onnx'));
    await assert.rejects(common.collectModels(root), /符号链接/u);
    await fs.rm(path.join(root, 'yolo11/yolo11n.onnx')); await fs.mkdir(path.join(root, 'yolo11/yolo11n.onnx'));
    await assert.rejects(common.collectModels(root), /普通文件/u);
});
