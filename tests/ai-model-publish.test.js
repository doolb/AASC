'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const common = require('../scripts/models/ai-model-common');
const { REMOTE_SCRIPT, validateDestination, remoteCommand, assertRequiredModels, publishModels } = require('../scripts/models/publish-ai-models');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-ai-remote-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}
function entry(name, text) {
    return { path: name, size: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') };
}
function payload(root, files, extra = {}) {
    const manifest = common.validateManifest({ schemaVersion: 1, files, totalBytes: files.reduce((sum, item) => sum + item.size, 0) });
    return { root, manifest, manifestBytes: common.manifestBytes(manifest).toString('base64'), ...extra };
}
async function run(value, script = REMOTE_SCRIPT) {
    const result = await execute('python3', ['-c', script, Buffer.from(JSON.stringify(value)).toString('base64')]);
    return JSON.parse(result.stdout);
}

test('SSH/路径参数拒绝选项注入、shell字符及越界', () => {
    validateDestination('as@120.79.245.103', '/home/as/a/aimodel');
    for (const [host, root] of [['-evil', '/tmp/aimodel'], ['as@host;id', '/tmp/aimodel'],
        ['host', '/'], ['host', '/tmp/../outside'], ['host', '/tmp/a b'], ['host', '/tmp/a$(id)']]) {
        assert.throws(() => validateDestination(host, root));
    }
});

test('SSH始终显式/bin/sh -c，payload不会进入未引用的shell参数', async () => {
    let captured;
    await remoteCommand('host', payload('/tmp/aimodel', [entry('sensevoice/model.int8.onnx', 'x')]), async (cmd, args) => {
        captured = { cmd, args }; return { stdout: '{}' };
    });
    assert.equal(captured.cmd, 'ssh'); assert.deepEqual(captured.args.slice(-3, -1), ['/bin/sh', '-c']);
    assert.ok(captured.args.at(-1).startsWith("'python3 -c "));
});

test('新检出的不完整本地模型集不能覆盖全量发布清单', () => {
    assert.throws(() => assertRequiredModels({ files: [entry('yolo11/yolo11n.onnx', 'x')] }), /不完整/u);
});

test('远端初次发布、重复比较、变化备份与额外文件保留', async t => {
    const parent = await fixture(t), root = path.join(parent, 'aimodel');
    const firstFile = entry('sensevoice/model.int8.onnx', 'first');
    const first = payload(root, [firstFile], { operation: 'probe' });
    const probe = await run(first); assert.deepEqual(probe.matched, []);
    await fs.mkdir(path.join(probe.stage, 'sensevoice')); await fs.writeFile(path.join(probe.stage, firstFile.path), 'first');
    await run({ ...first, operation: 'commit', stage: probe.stage, changed: [firstFile.path] });
    assert.deepEqual(await fs.readFile(path.join(root, 'manifest.json')), common.manifestBytes(first.manifest));
    const again = await run(first); assert.deepEqual(again.matched, [firstFile.path]);
    assert.equal(again.manifestMatches, true); assert.equal(again.stage, null);
    await fs.writeFile(path.join(root, 'extra.bin'), 'keep');
    const secondFile = entry(firstFile.path, 'second'), second = payload(root, [secondFile], { operation: 'probe' });
    const next = await run(second); await fs.mkdir(path.join(next.stage, 'sensevoice'));
    await fs.writeFile(path.join(next.stage, secondFile.path), 'second');
    const result = await run({ ...second, operation: 'commit', stage: next.stage, changed: [secondFile.path] });
    assert.equal(await fs.readFile(path.join(result.backup, firstFile.path), 'utf8'), 'first');
    assert.equal(await fs.readFile(path.join(root, firstFile.path), 'utf8'), 'second');
    assert.equal(await fs.readFile(path.join(root, 'extra.bin'), 'utf8'), 'keep');
});

test('上传校验失败时旧文件与旧清单保持', async t => {
    const parent = await fixture(t), root = path.join(parent, 'aimodel');
    await fs.mkdir(path.join(root, 'sensevoice'), { recursive: true });
    await fs.writeFile(path.join(root, 'sensevoice/model.int8.onnx'), 'old');
    await fs.writeFile(path.join(root, 'manifest.json'), 'old manifest');
    const file = entry('sensevoice/model.int8.onnx', 'new'), value = payload(root, [file], { operation: 'probe' });
    const probe = await run(value); await fs.mkdir(path.join(probe.stage, 'sensevoice'));
    await fs.writeFile(path.join(probe.stage, file.path), 'bad');
    await assert.rejects(run({ ...value, operation: 'commit', stage: probe.stage, changed: [file.path] }));
    assert.equal(await fs.readFile(path.join(root, file.path), 'utf8'), 'old');
    assert.equal(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'), 'old manifest');
});

test('远端第二次替换失败时回滚已替换项，不提前切换清单', async t => {
    const parent = await fixture(t), root = path.join(parent, 'aimodel');
    const files = [entry('sensevoice/model.int8.onnx', 'new'), entry('sensevoice/tokens.txt', 'new')];
    await fs.mkdir(path.join(root, 'sensevoice'), { recursive: true });
    for (const file of files) await fs.writeFile(path.join(root, file.path), 'old');
    await fs.writeFile(path.join(root, 'manifest.json'), 'old manifest');
    const value = payload(root, files, { operation: 'probe' }), probe = await run(value);
    await fs.mkdir(path.join(probe.stage, 'sensevoice'));
    for (const file of files) await fs.writeFile(path.join(probe.stage, file.path), 'new');
    // 注入第二次原子替换失败，实际执行远端Python的备份及回滚路径。
    const injected = `import os\noriginal=os.replace\ncalls=0\ndef replace(a,b):\n    global calls\n    calls+=1\n    if calls==2: raise OSError('injected')\n    return original(a,b)\nos.replace=replace\n` + REMOTE_SCRIPT;
    await assert.rejects(run({ ...value, operation: 'commit', stage: probe.stage, changed: files.map(file => file.path) }, injected));
    for (const file of files) assert.equal(await fs.readFile(path.join(root, file.path), 'utf8'), 'old');
    assert.equal(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'), 'old manifest');
});

test('远端目录符号链接被拒绝，外部文件不变', async t => {
    const parent = await fixture(t), outside = path.join(parent, 'outside');
    await fs.mkdir(outside); const root = path.join(parent, 'aimodel'); await fs.symlink(outside, root, 'dir');
    await assert.rejects(run(payload(root, [entry('sensevoice/model.int8.onnx', 'x')], { operation: 'probe' })));
    assert.deepEqual(await fs.readdir(outside), []);
});

test('完整上传入口串联文件列表、远端事务与HTTP校验，第二次不调用rsync', async t => {
    const parent = await fixture(t), localRoot = path.join(parent, 'local'), remoteRoot = path.join(parent, 'aimodel');
    const required = ['sensevoice/model.int8.onnx', 'sensevoice/tokens.txt',
        'streaming-zipformer/encoder.int8.onnx', 'streaming-zipformer/decoder.int8.onnx',
        'streaming-zipformer/joiner.int8.onnx', 'streaming-zipformer/tokens.txt',
        'voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
        'voiceprint/pyannote_segmentation_3_0_int8.onnx', 'speech-enhancement/gtcrn_simple.onnx',
        'yolo11/yolo11n.onnx', 'yolo11/yolo11n.classes.json'];
    for (const name of required) {
        await fs.mkdir(path.dirname(path.join(localRoot, name)), { recursive: true });
        await fs.writeFile(path.join(localRoot, name), name);
    }
    const commands = [];
    const runner = async (command, args) => {
        commands.push(command);
        if (command === 'ssh') {
            const shellCommand = args.at(-1).slice(1, -1).replaceAll("'\"'\"'", "'");
            const encoded = shellCommand.match(/'([A-Za-z0-9+/=]+)'$/u)[1];
            return execute('python3', ['-c', REMOTE_SCRIPT, encoded]);
        }
        assert.equal(command, 'rsync');
        assert.ok(!args.includes('--delete'));
        assert.equal(args.find(arg => arg.startsWith('--rsync-path=')), '--rsync-path=/bin/sh -c \'exec rsync "$@"\' sh');
        const names = (await fs.readFile(args.find(arg => arg.startsWith('--files-from=')).split('=')[1], 'utf8')).trim().split('\n');
        const stage = args.at(-1).split(':')[1];
        for (const name of names) {
            const target = path.join(stage, name); await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.copyFile(path.join(localRoot, name), target);
        }
        return { stdout: '' };
    };
    const fetchImpl = async url => new Response(await fs.readFile(path.join(remoteRoot, new URL(url).pathname.split('/aimodel/')[1])));
    const first = await publishModels({ root: localRoot, remoteRoot, host: 'host', runner, fetchImpl, log() {} });
    assert.equal(first.uploaded.length, 11); assert.equal(first.verified.length, 11);
    commands.length = 0;
    const again = await publishModels({ root: localRoot, remoteRoot, host: 'host', runner, fetchImpl, log() {} });
    assert.equal(again.uploaded.length, 0); assert.equal(again.reused.length, 11);
    assert.deepEqual(commands, ['ssh']);
});

test('服务器校验确实通过HTTP读取内容，坏哈希与重定向不会被视为通过', async t => {
    const parent = await fixture(t), root = path.join(parent, 'aimodel');
    const file = entry('sensevoice/model.int8.onnx', 'model');
    const value = payload(root, [file], { operation: 'verify' });
    let mode = 'valid';
    const server = http.createServer((request, response) => {
        if (request.url.endsWith('/manifest.json')) { response.end(common.manifestBytes(value.manifest)); return; }
        if (mode === 'redirect') { response.writeHead(302, { Location: '/outside' }).end(); return; }
        response.end(mode === 'valid' ? 'model' : 'wrong');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    value.source = `http://127.0.0.1:${server.address().port}/aimodel/`;
    const result = await run(value); assert.deepEqual(result.verified, [file.path]);
    mode = 'invalid'; await assert.rejects(run(value));
    mode = 'redirect'; await assert.rejects(run(value));
});
