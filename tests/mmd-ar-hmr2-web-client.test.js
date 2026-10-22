const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../3rd/hmr2-node-onnx/core/model-catalog.json');
const load = async suffix => {
    assert.ok(fs.existsSync(path.resolve(__dirname, '../3rd/mmd-ar-test/web-human-hmr2-web-' + suffix + '.mjs')), suffix + '模块应存在');
    return import('../3rd/mmd-ar-test/web-human-hmr2-web-' + suffix + '.mjs');
};
const manifest = () => ({ schemaVersion: 1, source: 'hmr2-web', available: true, modelId: catalog.id, runtimeVersion: '1.26.0',
    files: [...catalog.files.map(f => ({ name: f.path, bytes: f.bytes, sha256: f.sha256 })),
        ...['ort.webgpu.min.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'opencv.mjs'].map(name => ({ name, bytes: 10, sha256: 'a'.repeat(64) }))] });

test('增量SHA跨任意分块与Node摘要一致', async () => {
    const { RawSha256 } = await import('../3rd/mmd-ar-test/hmr2-vendor/RawSha256.mjs');
    for (const size of [0, 1, 55, 56, 63, 64, 65, 1024 * 1024 + 1]) {
        const bytes = crypto.randomBytes(size), sha = new RawSha256();
        for (let offset = 0; offset < size; offset += 317) sha.update(bytes.subarray(offset, offset + 317));
        assert.equal(Buffer.from(sha.digest()).toString('hex'), crypto.createHash('sha256').update(bytes).digest('hex'));
    }
});

test('增量SHA超过512MiB后长度高位仍与Node摘要一致', async () => {
    const { RawSha256 } = await import('../3rd/mmd-ar-test/hmr2-vendor/RawSha256.mjs');
    // 重复使用1MiB分块，覆盖64位消息长度而不在测试中分配大模型内存。
    const chunk = Buffer.alloc(1024 * 1024, 37), sha = new RawSha256(), expected = crypto.createHash('sha256');
    for (let index = 0; index < 512; index++) { sha.update(chunk); expected.update(chunk); }
    sha.update(chunk.subarray(0, 1)); expected.update(chunk.subarray(0, 1));
    assert.equal(Buffer.from(sha.digest()).toString('hex'), expected.digest('hex'));
});

test('probe只读取小清单与HEAD，缺模型/缺文件/不支持WebGPU时不可用', async () => {
    const { probeHmrWebAssets } = await load('resources');
    const calls = [], config = { baseUrl: 'http://localhost/hmr/', capability: async () => true };
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || 'GET' });
        if (String(url).includes('models.json')) return new Response(JSON.stringify(manifest()));
        const file = manifest().files.find(f => String(url).endsWith(f.name));
        return new Response(null, { status: 200, headers: { 'content-length': String(file.bytes) } });
    };
    assert.equal((await probeHmrWebAssets({ ...config, fetchImpl })).available, true);
    assert.equal(calls.filter(c => c.method === 'GET').length, 1);
    assert.equal((await probeHmrWebAssets({ ...config, fetchImpl, capability: async () => false })).available, false);
    assert.equal((await probeHmrWebAssets({ ...config, fetchImpl: async () => new Response('', { status: 404 }) })).available, false);
    const missingData = async (url, init) => String(url).endsWith('model.onnx.data') ? new Response('', { status: 404 }) : fetchImpl(url, init);
    assert.equal((await probeHmrWebAssets({ ...config, fetchImpl: missingData })).available, false);
});

test('有界流式读取检查实际长度及完整SHA，拒绝截断/超长/内容错误', async () => {
    const { readHmrAsset } = await load('resources');
    const { RawSha256 } = await import('../3rd/mmd-ar-test/hmr2-vendor/RawSha256.mjs');
    const bytes = Uint8Array.of(1, 2, 3, 4, 5), file = { name: 'fixture', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    const options = { hashFactory: () => new RawSha256(), fetchImpl: async () => new Response(bytes) };
    assert.deepEqual(await readHmrAsset('http://localhost/fixture', file, options), bytes);
    for (const bad of [bytes.slice(1), Uint8Array.of(1, 2, 3, 4, 5, 6), Uint8Array.of(1, 2, 3, 4, 9)]) {
        await assert.rejects(readHmrAsset('http://localhost/fixture', file, { ...options, fetchImpl: async () => new Response(bad) }));
    }
});

test('客户端取消/超时释放Worker，旧消息不得成为新任务结果', async () => {
    const { createHmrWebClient } = await load('client');
    const workers = [], makeWorker = () => {
        const worker = { messages: [], terminated: false, postMessage(data) { this.messages.push(data); }, terminate() { this.terminated = true; } };
        workers.push(worker); return worker;
    };
    const image = { width: 1, height: 1, data: new Uint8Array(4) };
    const client = createHmrWebClient({ workerFactory: makeWorker, timeoutMs: 30 });
    const first = client.infer(image), rejected = assert.rejects(first, { name: 'AbortError' });
    const old = workers[0], oldCallback = old.onmessage;
    client.cancel(); await rejected; assert.equal(old.terminated, true);
    const second = client.infer(image);
    oldCallback({ data: { type: 'error', id: old.messages[0].id, message: '旧错误' } });
    await assert.rejects(second, { name: 'TimeoutError' }); assert.equal(workers[1].terminated, true);
    assert.equal(image.data.byteLength, 4); client.dispose();
    await assert.rejects(client.infer(image), /关闭/);
});
