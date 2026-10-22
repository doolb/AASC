const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../3rd/hmr2-node-onnx/core/model-catalog.json');
const modulePath = '../3rd/mmd-ar-test/web-human-hmr2-web-';
const runtimeFiles = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'opencv.mjs'];
const cpuManifest = () => ({ schemaVersion: 1, source: 'hmr2-web', available: true, modelId: catalog.id, runtimeVersion: '1.26.0',
    files: [...catalog.files.map(f => ({ name: f.path, bytes: f.bytes, sha256: f.sha256 })),
        ...runtimeFiles.map(name => ({ name, bytes: 10, sha256: 'a'.repeat(64) }))] });

test('WASM能力和资源门禁无需WebGPU；缺CPU运行时不能借GPU清单通过', async () => {
    const { hmrWebCapability, probeHmrWebAssets, getHmrWebBackend } = await import(modulePath + 'resources.mjs');
    assert.equal(await hmrWebCapability('wasm', { WebAssembly, Worker: function () {} }), true);
    assert.equal(await hmrWebCapability('webgpu', { WebAssembly }), false);
    assert.equal(getHmrWebBackend('wasm').device, 'cpu');
    assert.throws(() => getHmrWebBackend('constructor'), /后端/);
    const requests = [], fetchImpl = async (url, init = {}) => {
        requests.push({ url: String(url), method: init.method || 'GET' });
        if (String(url).endsWith('models.json')) return new Response(JSON.stringify(cpuManifest()));
        const file = cpuManifest().files.find(f => String(url).endsWith(f.name));
        return new Response(null, { status: file ? 200 : 404, headers: file ? { 'content-length': String(file.bytes) } : {} });
    };
    const config = { baseUrl: 'http://localhost/hmr/', fetchImpl, capability: async backend => backend === 'wasm' };
    assert.equal((await probeHmrWebAssets({ ...config, backend: 'wasm' })).available, true);
    assert.equal((await probeHmrWebAssets({ ...config, backend: 'webgpu' })).available, false);
    assert.equal(requests.some(r => r.method === 'GET' && r.url.endsWith('.data')), false);
    assert.equal((await probeHmrWebAssets({ ...config, backend: 'wasm', fetchImpl: async (url, init) =>
        String(url).endsWith('ort-wasm-simd-threaded.wasm') ? new Response(null, { status: 404 }) : fetchImpl(url, init) })).available, false);
    const gpuFiles = ['ort.webgpu.min.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']
        .map(name => ({ name, bytes: 10, sha256: 'a'.repeat(64) }));
    const both = cpuManifest(); both.files.push(...gpuFiles);
    const bothFetch = async (url, init) => String(url).endsWith('models.json') ? new Response(JSON.stringify(both)) : fetchImpl(url, init);
    // 即使GPU资源实际404，CPU只检查自身运行时，仍可用。
    assert.equal((await probeHmrWebAssets({ ...config, backend: 'wasm', fetchImpl: bothFetch })).available, true);
    const oldGpu = { ...both, files: both.files.filter(f => !runtimeFiles.slice(0, 3).includes(f.name)) };
    assert.equal((await probeHmrWebAssets({ ...config, backend: 'wasm', fetchImpl: async () => new Response(JSON.stringify(oldGpu)) })).available, false);
});

test('切换后端必须终止旧Worker，回包设备与当前请求一致', async t => {
    const { createHmrWebClient } = await import(modulePath + 'client.mjs');
    const core = await import(modulePath + 'core.mjs');
    const workers = [], workerFactory = () => {
        const worker = { postMessage(data) { this.last = data; }, terminate() { this.terminated = true; } }; workers.push(worker); return worker;
    };
    const client = createHmrWebClient({ workerFactory, timeoutMs: 1000 }), picture = { width: 2, height: 2, data: new Uint8Array(16) };
    t.after(() => client.dispose());
    const gpu = client.infer(picture), cancelled = assert.rejects(gpu, { name: 'AbortError' });
    const cpu = client.infer(picture, { backend: 'wasm' }); cpu.catch(() => {});
    await cancelled; assert.equal(workers[0].terminated, true); assert.equal(workers[1].last.backend, 'wasm');
    const outputs = Object.fromEntries(Object.entries(core.HMR_OUTPUT_SHAPES).map(([name, dims]) =>
        [name, { type: 'float32', dims, data: new Float32Array(dims.reduce((a, b) => a * b, 1)) }]));
    outputs.cameraDepth.data.fill(1); outputs.cameraTranslation.data[2] = 1;
    outputs.focalLengthPx.data[0] = 5000; outputs.principalPointPx.data.fill(1);
    const raw = core.decodeHmrWebOutputs(outputs, { imageSize: [2, 2], boxXYXY: [0, 0, 2, 2], bboxSource: 'full_image_fallback' }, 'wasm');
    assert.equal(raw.device, 'cpu'); raw.inferenceMs = 1;
    workers[1].onmessage({ data: { id: workers[1].last.id, type: 'result', result: raw } });
    assert.equal((await cpu).raw.device, 'cpu');
    const warm = client.infer(picture, { backend: 'wasm' }); assert.equal(workers.length, 2);
    workers[1].onmessage({ data: { id: workers[1].last.id, type: 'result', result: raw } }); await warm;
    const switched = client.infer(picture, { backend: 'webgpu' });
    assert.equal(workers.length, 3); assert.equal(workers[1].terminated, true);
    const rejected = assert.rejects(switched, /匹配/);
    workers[2].onmessage({ data: { id: workers[2].last.id, type: 'result', result: raw } });
    await rejected; assert.equal(workers[2].terminated, true);
    await assert.rejects(client.infer(picture, { backend: 'invalid' }), /后端/); client.dispose();
});
