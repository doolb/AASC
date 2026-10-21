'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assets = require('../3rd/mmd-ar-test/web-human-depth-assets.js');
const corePromise = import('../3rd/mmd-ar-test/web-human-depth-core.mjs');
const project = path.resolve(__dirname, '..');
const localCache = path.join(project, 'tmp/mmd-pose/depth-eval/rigid-projection');
function image(width = 1, height = 1, rgb = [255, 128, 0, 255]) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(rgb, i * 4);
    return { width, height, data };
}
function fixtureDepth(core, width = 100, height = 100) {
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = x;
    return core.decodeDepthOutput(data, [1, height, width], { inputWidth: width, inputHeight: height, inferenceMs: 3 });
}
function point(key, x = .25, y = .5, usable = true) { return { key, x, y, usable }; }
async function temporary(callback) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mmd-human-depth-test-'));
    try { return await callback(directory); }
    finally {
        // 删除只限本测试新建的、已核对绝对根与前缀的临时目录，不接触用户模型或构建产物。
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('mmd-human-depth-test-'));
        await fs.rm(directory, { recursive: true, force: true });
    }
}

test('RGB最小缩放/14倍数/ImageNet NCHW，不修改当前RGBA或采用alpha作为深度通道', async () => {
    const core = await corePromise, original = image(14, 14, [255, 128, 0, 0]);
    const before = original.data.slice(), result = core.prepareDepthInput(original, core.DEPTH_CONFIG), plane = result.width * result.height;
    assert.deepEqual([result.width, result.height], [518, 518]);
    assert.equal(result.data.length, 3 * plane); assert.ok(result.data instanceof Float32Array);
    const expected = [(1 - .485) / .229, (128 / 255 - .456) / .224, (0 - .406) / .225];
    for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs(result.data[c * plane] - expected[c]) < 1e-6);
        assert.ok(Math.abs(result.data[c * plane + plane - 1] - expected[c]) < 1e-6);
    }
    assert.deepEqual(original.data, before); assert.ok(result.data.every(Number.isFinite));
});

test('minimal保持整图无裁切且14倍数；1600源图与模型输入预算在分配张量前拒绝', async () => {
    const core = await corePromise;
    assert.deepEqual(core.depthInputDimensions(image(518, 686)), { width: 518, height: 686 });
    assert.deepEqual(core.depthInputDimensions(image(462, 518)), { width: 462, height: 518 });
    assert.deepEqual(core.depthInputDimensions(image(14, 28)), { width: 266, height: 518 });
    assert.deepEqual(core.depthInputDimensions(image(1600, 1)), { width: 518, height: 14 });
    assert.throws(() => core.prepareDepthInput(image(1601, 1)), /1600/u);
    assert.deepEqual(core.depthInputDimensions(image(1000, 600)), { width: 868, height: 518 });
    assert.deepEqual(core.depthInputDimensions(image(1600, 900)), { width: 924, height: 518 });
    assert.throws(() => core.prepareDepthInput(image(1600, 600)), /预算/u);
    assert.throws(() => core.prepareDepthInput({ width: 1, height: 1, data: new Float32Array([NaN, 0, 0, 0]) }), /像素/u);
    assert.throws(() => core.prepareDepthInput({ width: 1, height: 1, data: new Uint8ClampedArray(3) }), /像素/u);
    assert.throws(() => core.prepareDepthInput('https://example.test/image.png'), /像素/u);
});

test('固定预处理配置拒绝归一化/补边/缩放版本漂移；独立双三次RGB保持左右像素映射', async () => {
    const core = await corePromise;
    for (const config of [{ ...core.DEPTH_CONFIG, do_pad: true }, { ...core.DEPTH_CONFIG, ensure_multiple_of: 16 },
        { ...core.DEPTH_CONFIG, image_std: [.229, .224, 0] }, { ...core.DEPTH_CONFIG, size: { width: 512, height: 512 } }]) {
        assert.throws(() => core.prepareDepthInput(image(), config), /配置/u);
    }
    const original = image(14, 14, [0, 0, 255, 255]);
    for (let y = 0; y < 14; y++) for (let x = 0; x < 7; x++) original.data.set([255, 0, 0, 255], (y * 14 + x) * 4);
    const { data, width, height } = core.prepareDepthInput(original), plane = width * height;
    assert.ok(data[0] > data[width - 1]); assert.ok(data[2 * plane] < data[2 * plane + width - 1]);
});

test('[1,H,W]输出保留独立Float32数据/P5/P95/输入尺寸/耗时，拒绝损坏shape及有限性', async () => {
    const core = await corePromise, data = Float32Array.from({ length: 100 }, (_, i) => i + .125);
    const result = core.decodeDepthOutput(data, [1, 10, 10], { inputWidth: 10, inputHeight: 10, inferenceMs: 12.5 });
    assert.equal(result.source, 'depth-anything-v2-small'); assert.equal(result.low, 5.125); assert.equal(result.high, 95.125);
    assert.equal(result.inferenceMs, 12.5); assert.equal(result.data[9], 9.125); data[9] = -99; assert.equal(result.data[9], 9.125);
    for (const dims of [[10, 10], [1, 1, 10, 10], [2, 10, 10], [1, 0, 100], [1, 10.5, 10], [1, 11, 10]]) {
        assert.throws(() => core.decodeDepthOutput(data, dims), /输出|预算/u);
    }
    for (const value of [NaN, Infinity, -Infinity]) {
        const bad = data.slice(); bad[3] = value;
        assert.throws(() => core.decodeDepthOutput(bad, [1, 10, 10]), /有限性/u);
    }
    assert.throws(() => core.decodeDepthOutput(Array.from(data), [1, 10, 10]), /浮点/u);
    assert.throws(() => core.decodeDepthOutput(data, [1, 10, 10], { inputWidth: 9, inputHeight: 10 }), /尺寸/u);
    assert.throws(() => core.decodeDepthOutput(data, [1, 10, 10], { inferenceMs: NaN }), /耗时/u);
});

test('热图单图P5/P95蓝远黄近，透明度255且退化中性灰，不改原始浮点值', async () => {
    const core = await corePromise, depth = fixtureDepth(core, 100, 1), before = depth.data.slice();
    const pixels = core.depthHeatmap(depth);
    assert.ok(pixels instanceof Uint8ClampedArray); assert.equal(pixels.length, 400);
    assert.deepEqual(Array.from(pixels.slice(0, 4)), [0, 0, 255, 255]);
    assert.deepEqual(Array.from(pixels.slice(-4)), [255, 200, 0, 255]);
    assert.deepEqual(depth.data, before);
    const constant = core.decodeDepthOutput(new Float32Array(9).fill(4.75), [1, 3, 3]);
    assert.deepEqual(Array.from(core.depthHeatmap(constant).slice(0, 4)), [128, 128, 128, 255]);
    assert.throws(() => core.depthHeatmap({ ...depth, high: Infinity }), /范围/u);
    assert.throws(() => core.depthHeatmap({ ...depth, source: 'fake-depth' }), /来源/u);
});

test('5×5中位数相对顺序仅PMX body12语义，b-a正相机深度符号正确且不生成米制骨z', async () => {
    const core = await corePromise, depth = fixtureDepth(core), near = point('leftElbow', .75), far = point('leftArm', .25);
    const result = core.buildDepthHints(depth, [far, near, point('nose', .5), point('leftShoulder', .5)]);
    assert.equal(result.hints.length, 1); assert.equal(result.rejected.length, 7);
    assert.deepEqual(result.hints[0], { a: 'leftArm', b: 'leftElbow', sign: -1, weight: .25,
        normalizedDifference: (74 - 25) / 90, ownership: 'unverified-visible-surface' });
    assert.ok(!('z' in result.hints[0])); assert.ok(!('depthMeters' in result.hints[0]));
    const swapped = core.buildDepthHints(depth, [point('leftArm', .75), point('leftElbow', .25)]);
    assert.equal(swapped.hints[0].sign, 1);
    assert.equal(core.DEPTH_BODY_KEYS.length, 12); assert.ok(result.hints.every(hint => core.DEPTH_BODY_KEYS.includes(hint.a) && core.DEPTH_BODY_KEYS.includes(hint.b)));
});

test('中位数容忍少数局部异常点，边界/出画/不可用/重复/小差异拒绝', async () => {
    const core = await corePromise, depth = fixtureDepth(core);
    // 每个邻域两点异常不污染P10/P90与中位数；全图归一化范围沿用原本浮点图。
    depth.data[48 * 100 + 23] = -1000; depth.data[48 * 100 + 24] = 1000;
    assert.equal(core.buildDepthHints(depth, [point('leftArm', .25), point('leftElbow', .75)]).hints.length, 1);
    for (const bad of [point('leftArm', -.1), point('leftArm', 1.1), point('leftArm', .019), point('leftArm', .99),
        point('leftArm', .25, .5, false), point('leftArm', NaN), { key: 'leftArm', x: .25, y: .5, usable: 1 }]) {
        const result = core.buildDepthHints(depth, [bad, point('leftElbow', .75)]);
        assert.equal(result.hints.length, 0); assert.equal(result.rejected.length, 8);
    }
    assert.equal(core.buildDepthHints(depth, [point('leftArm', .25), point('leftElbow', .26)]).hints.length, 0);
    assert.equal(core.buildDepthHints(depth, [point('leftArm', .25), point('leftArm', .75), point('leftElbow', .75)]).hints.length, 0);
    const tiny = core.decodeDepthOutput(new Float32Array([0, 1, 2, 3]), [1, 2, 2]);
    assert.equal(core.buildDepthHints(tiny, [point('leftArm'), point('leftElbow', .75)]).hints.length, 0);
});

test('局部spread必须<.12且absDelta>=.07；整图退化拒绝，不伪造表面归属', async () => {
    const core = await corePromise, depth = fixtureDepth(core);
    for (let y = 48; y <= 52; y++) for (let x = 23; x <= 27; x++) depth.data[y * 100 + x] = x % 2 ? 5 : 95;
    const unstable = core.buildDepthHints(depth, [point('leftArm', .25), point('leftElbow', .75)]);
    assert.equal(unstable.hints.length, 0); assert.match(unstable.rejected[0].reason, /不稳定/u);
    const exact = core.decodeDepthOutput(new Float32Array(10000), [1, 100, 100]); exact.low = 0; exact.high = 25;
    const patch = (cx, value) => { for (let y = 48; y <= 52; y++) for (let x = cx - 2; x <= cx + 2; x++) exact.data[y * 100 + x] = value; };
    patch(25, 1); patch(74, 2.75);
    assert.equal(core.buildDepthHints(exact, [point('leftArm', .25), point('leftElbow', .75)]).hints[0].normalizedDifference, .07);
    patch(74, 2.749);
    assert.equal(core.buildDepthHints(exact, [point('leftArm', .25), point('leftElbow', .75)]).hints.length, 0);
    // P90-P10正好为3，除以25等于0.12；严格小于的门禁应拒绝等号。
    patch(74, 10);
    for (let y = 48; y <= 52; y++) for (let x = 23; x <= 27; x++) exact.data[y * 100 + x] = x % 2 ? 1 : 4;
    const boundarySpread = core.buildDepthHints(exact, [point('leftArm', .25), point('leftElbow', .75)]);
    assert.equal(boundarySpread.hints.length, 0); assert.match(boundarySpread.rejected[0].reason, /不稳定/u);
    const constant = core.decodeDepthOutput(new Float32Array(10000).fill(3), [1, 100, 100]);
    const rejected = core.buildDepthHints(constant, [point('leftArm'), point('leftElbow', .75)]);
    assert.equal(rejected.hints.length, 0); assert.ok(rejected.rejected.every(item => /退化/u.test(item.reason)));
    const bad = fixtureDepth(core); bad.data[0] = NaN;
    assert.throws(() => core.buildDepthHints(bad, []), /有限性/u);
});

function fakeWorkers() {
    const workers = [];
    return { workers, workerFactory() {
        const worker = { closed: 0, messages: [], postMessage(message, transfer) { this.messages.push(message); this.transfer = transfer; }, terminate() { this.closed++; } };
        workers.push(worker); return worker;
    } };
}
async function respond(worker, data = null) {
    const core = await corePromise, message = worker.messages.at(-1), size = core.depthInputDimensions(message.image);
    const result = core.decodeDepthOutput(data || new Float32Array(size.width * size.height).fill(1.25), [1, size.height, size.width],
        { inputWidth: size.width, inputHeight: size.height, inferenceMs: 7 });
    worker.onmessage({ data: { type: 'result', id: message.id, result } });
}

test('客户端按需创建/热次重用，cancel终止且旧消息/旧error及旧Promise不污染新任务', async () => {
    const { createDepthClient } = await import('../3rd/mmd-ar-test/web-human-depth-client.mjs');
    const fake = fakeWorkers(), client = createDepthClient(fake), original = image(), before = original.data.slice(), progress = [];
    assert.equal(fake.workers.length, 0);
    const first = client.infer(original).catch(error => error.name), oldMessage = fake.workers[0].onmessage, oldError = fake.workers[0].onerror;
    const second = client.infer(original, message => progress.push(message));
    assert.equal(await first, 'AbortError'); assert.equal(fake.workers[0].closed, 1);
    const worker = fake.workers[1], id = worker.messages[0].id;
    oldMessage({ data: { type: 'result', id, result: '不能替代新任务' } }); oldError({ message: '旧线程失败' });
    worker.onmessage({ data: { type: 'progress', id: id - 1, message: '旧进度' } });
    worker.onmessage({ data: { type: 'progress', id, message: '当前图推理' } });
    await respond(worker); assert.equal((await second).source, 'depth-anything-v2-small'); assert.deepEqual(progress, ['当前图推理']);
    const third = client.infer(original); assert.equal(fake.workers.length, 2); await respond(worker); await third;
    assert.notEqual(worker.messages[0].image.data.buffer, original.data.buffer); assert.deepEqual(original.data, before);
    client.dispose(); client.dispose(); assert.equal(worker.closed, 1); await assert.rejects(client.infer(original), /关闭/u);
});

test('取消/传输失败/Worker失败/超时都释放，坏数据或URL不返回结果，进度异常不悬挂', async () => {
    const { createDepthClient } = await import('../3rd/mmd-ar-test/web-human-depth-client.mjs');
    const fake = fakeWorkers(), client = createDepthClient(fake);
    await assert.rejects(client.infer('https://example.test/no-url'), /像素/u); assert.equal(fake.workers.length, 0);
    const pending = client.infer(image()).catch(error => error.name); client.cancel(); assert.equal(await pending, 'AbortError'); assert.equal(fake.workers[0].closed, 1);
    const errorTask = client.infer(image()).catch(error => error.message); fake.workers[1].onerror({ message: '模块不存在' });
    assert.equal(await errorTask, '模块不存在'); assert.equal(fake.workers[1].closed, 1);
    const badTask = client.infer(image()).catch(error => error.message), badWorker = fake.workers[2];
    badWorker.onmessage({ data: { type: 'result', id: badWorker.messages[0].id, result: { source: 'fake', data: new Float32Array(1) } } });
    assert.match(await badTask, /不匹配/u); assert.equal(badWorker.closed, 1);
    const progressTask = client.infer(image(), () => { throw new Error('UI已关闭'); }), lastWorker = fake.workers[3];
    lastWorker.onmessage({ data: { type: 'progress', id: lastWorker.messages[0].id, message: '不会挂起' } }); await respond(lastWorker); await progressTask; client.dispose();
    let terminated = 0;
    const broken = createDepthClient({ workerFactory: () => ({ postMessage() { throw new Error('无法克隆'); }, terminate() { terminated++; } }) });
    await assert.rejects(broken.infer(image()), /无法克隆/u); assert.equal(terminated, 1); broken.dispose();
    const timed = fakeWorkers(), timeoutClient = createDepthClient({ ...timed, timeoutMs: 5 });
    await assert.rejects(timeoutClient.infer(image()), { name: 'TimeoutError' }); assert.equal(timed.workers[0].closed, 1); timeoutClient.dispose();
});

function manifest() { return { source: assets.SOURCE, repository: assets.REPOSITORY, revision: assets.REVISION, license: 'Apache-2.0', runtime: '1.26.0', files: assets.FILES, models: assets.MODELS }; }
async function workerFixture({ failShape = false, delayRun = false, cryptoImpl = crypto.webcrypto, manifestData = manifest(), contentEncoding = null } = {}) {
    const { createDepthWorkerRuntime } = await import('../3rd/mmd-ar-test/web-human-depth-worker.mjs');
    const files = new Map(await Promise.all(assets.FILES.slice(0, 2).map(async file => [file.name, await fs.readFile(path.join(localCache, file.name))])));
    const state = { posts: [], fetches: [], created: 0, released: 0, inputsDisposed: 0, outputsDisposed: 0, runs: 0, resolveRun: null };
    let runReady; state.runReady = new Promise(resolve => { runReady = resolve; });
    const outputsFor = input => {
        const [, , height, width] = input.dims, values = new Float32Array(height * width).fill(1.25);
        return { predicted_depth: { data: values, dims: failShape ? [1, height - 1, width] : [1, height, width], dispose() { state.outputsDisposed++; values.fill(NaN); } },
            diagnostic: { data: new Float32Array(1), dims: [1], dispose() { state.outputsDisposed++; } } };
    };
    const ort = { env: { wasm: {}, versions: { web: '1.26.0' } },
        Tensor: class { constructor(type, data, dims) { assert.equal(type, 'float32'); this.data = data; this.dims = dims; } dispose() { state.inputsDisposed++; } },
        InferenceSession: { async create(bytes, options) {
            state.created++; assert.equal(bytes.length, assets.MODELS[0].size); assert.deepEqual(options.executionProviders, ['wasm']);
            return { inputNames: ['pixel_values'], outputNames: ['predicted_depth'], async run(inputs) {
                state.runs++; const input = inputs.pixel_values;
                if (!delayRun) return outputsFor(input);
                return await new Promise(resolve => { state.resolveRun = () => resolve(outputsFor(input)); runReady(); });
            }, async release() { state.released++; } };
        } } };
    let ticks = 0;
    state.runtime = createDepthWorkerRuntime({ scope: { postMessage(message, transfer) { state.posts.push({ ...message, transfer }); } },
        importOrt: async () => ort, cryptoImpl, now: () => { ticks += 5; return ticks; },
        fetchImpl: async url => {
            state.fetches.push(url); const name = new URL(url).pathname.split('/').at(-1);
            if (name === 'models.json') return new Response(JSON.stringify(manifestData));
            const bytes = files.get(name); assert.ok(bytes, '只能读取固定部署文件：' + name);
            return new Response(bytes, { headers: contentEncoding
                ? { 'content-length': '1', 'content-encoding': contentEncoding }
                : { 'content-length': String(bytes.length) } });
        } });
    state.ort = ort; return state;
}

test('Worker真实本机资源SHA校验、WASM单线程资源契约、会话热重用及每次张量释放', async () => {
    const state = await workerFixture();
    await state.runtime.handleMessage({ data: { type: 'infer', id: 1, image: image() } });
    await state.runtime.handleMessage({ data: { type: 'infer', id: 2, image: image() } });
    assert.equal(state.created, 1); assert.equal(state.runs, 2); assert.equal(state.fetches.length, 3);
    assert.equal(state.ort.env.wasm.numThreads, 1); assert.equal(state.ort.env.wasm.proxy, false);
    assert.match(state.ort.env.wasm.wasmPaths, /\/vendor\/pose\/$/u);
    const results = state.posts.filter(message => message.type === 'result'); assert.equal(results.length, 2);
    assert.equal(results[0].result.data[0], 1.25); assert.equal(results[0].result.inferenceMs, 5);
    assert.deepEqual(results[0].transfer, [results[0].result.data.buffer]);
    assert.equal(state.inputsDisposed, 2); assert.equal(state.outputsDisposed, 4); assert.equal(state.released, 0);
    assert.ok(state.fetches.every(url => url.includes('/vendor/depth/') && !url.includes('/tmp/') && !url.includes('/_depth/')));
    await state.runtime.dispose(); await state.runtime.dispose(); assert.equal(state.released, 1);
});

test('Worker坏输出释放会话/所有张量；输入超预算或漂移清单不加载模型', async () => {
    const invalid = await workerFixture({ failShape: true });
    await invalid.runtime.handleMessage({ data: { type: 'infer', id: 1, image: image() } });
    assert.equal(invalid.posts.filter(message => message.type === 'result').length, 0);
    assert.match(invalid.posts.find(message => message.type === 'error').message, /形状/u);
    assert.equal(invalid.inputsDisposed, 1); assert.equal(invalid.outputsDisposed, 2); assert.equal(invalid.released, 1);
    await invalid.runtime.dispose(); assert.equal(invalid.released, 1);
    const rejected = await workerFixture({ manifestData: { ...manifest(), revision: 'main' } });
    await rejected.runtime.handleMessage({ data: { type: 'infer', id: 2, image: image(1600, 600) } });
    assert.equal(rejected.fetches.length, 0); assert.equal(rejected.created, 0);
    await rejected.runtime.handleMessage({ data: { type: 'infer', id: 3, image: image() } });
    assert.equal(rejected.fetches.length, 1); assert.equal(rejected.created, 0);
    assert.ok(rejected.posts.some(message => message.type === 'error' && /清单/u.test(message.message))); await rejected.runtime.dispose();
});

test('Worker SHA不符必须在创建ORT会话前失败，不能仅因大小相同接受资源', async () => {
    const state = await workerFixture({ cryptoImpl: { subtle: { async digest() { return new Uint8Array(32).buffer; } } } });
    await state.runtime.handleMessage({ data: { type: 'infer', id: 1, image: image() } });
    assert.equal(state.created, 0); assert.equal(state.runs, 0); assert.equal(state.fetches.length, 2);
    assert.ok(state.posts.some(message => message.type === 'error' && /SHA-256不匹配/u.test(message.message)));
    await state.runtime.dispose(); assert.equal(state.released, 0);
});

test('Worker进行中dispose拒绝迟到结果且释放session，LAN HTTP无SubtleCrypto仍使用已校验资源', async () => {
    const state = await workerFixture({ delayRun: true, cryptoImpl: {} });
    const task = state.runtime.handleMessage({ data: { type: 'infer', id: 1, image: image() } }); await state.runReady;
    await state.runtime.handleMessage({ data: { type: 'infer', id: 2, image: image() } });
    assert.ok(state.posts.some(message => message.id === 2 && message.type === 'error' && /已有任务/u.test(message.message)));
    const disposing = state.runtime.dispose(); state.resolveRun(); await task; await disposing;
    assert.equal(state.posts.filter(message => message.type === 'result').length, 0); assert.equal(state.released, 1);
    assert.equal(state.inputsDisposed, 1); assert.equal(state.outputsDisposed, 2);
});

test('深度资产与浏览器常量保持同固定revision/SHA/许可/预算，复用pose的匹配ORT而非tmp路由', async () => {
    const core = await corePromise, worker = await import('../3rd/mmd-ar-test/web-human-depth-worker.mjs');
    assert.equal(assets.REVISION, core.DEPTH_REVISION); assert.equal(assets.REPOSITORY, core.DEPTH_REPOSITORY);
    assert.equal(assets.SOURCE, core.DEPTH_SOURCE); assert.deepEqual(assets.FILES, core.DEPTH_FILES); assert.deepEqual(assets.LIMITS, core.DEPTH_LIMITS);
    assert.equal(assets.MODELS.length, 1); assert.equal(assets.MODELS[0].size, 27258801);
    assert.deepEqual(worker.DEPTH_RESOURCE_PATHS, { ort: './vendor/pose/ort.wasm.min.mjs', wasm: './vendor/pose/', depth: './vendor/depth/' });
    const text = await fs.readFile(path.join(project, '3rd/mmd-ar-test/web-human-depth-worker.mjs'), 'utf8');
    assert.doesNotMatch(text, /['"]\/(?:_depth|ort)\//u); assert.doesNotMatch(text, /drawImage|new Image\(|image\.src/u);
});

test('stage向独立部署根复制真实本机模型/配置/模型卡/许可证与清单，不下载或新增ORT副本', async () => {
    await temporary(async directory => {
        const outputRoot = path.join(directory, 'web-dist'), cacheRoot = path.join(directory, 'cache');
        const result = await assets.stageDepthAssets(outputRoot, { cacheRoot, preferredCacheRoot: localCache, allowDownload: false,
            fetchImpl: async () => { throw new Error('不应下载新模型'); } });
        assert.equal(result.output, path.join(outputRoot, 'js/vendor/depth'));
        for (const file of [...assets.FILES, assets.LICENSE]) {
            const bytes = await fs.readFile(path.join(result.output, file.name));
            assert.equal(bytes.length, file.size); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256);
        }
        const outputManifest = JSON.parse(await fs.readFile(path.join(result.output, 'models.json'), 'utf8'));
        assert.equal(outputManifest.license, 'Apache-2.0'); assert.equal(outputManifest.revision, assets.REVISION);
        assert.deepEqual(outputManifest.models, assets.MODELS); assert.deepEqual(outputManifest.files, assets.FILES);
        assert.match(await fs.readFile(path.join(result.output, 'NOTICES.md'), 'utf8'), /不是米制距离/u);
        await assert.rejects(fs.stat(path.join(result.output, 'ort.wasm.min.mjs')), { code: 'ENOENT' });
        const second = await assets.stageDepthAssets(outputRoot, { cacheRoot, preferredCacheRoot: null, allowDownload: false });
        assert.deepEqual(second.manifest, result.manifest);
    });
});

test('Worker接受gzip/br压缩传输头，仍按fetch解码后的固定真实字节与SHA验证', async () => {
    for (const contentEncoding of ['gzip', 'br']) {
        const state = await workerFixture({ contentEncoding });
        try {
            await state.runtime.handleMessage({ data: { type: 'infer', id: 1, image: image() } });
            assert.equal(state.created, 1); assert.equal(state.posts.filter(message => message.type === 'result').length, 1);
        } finally { await state.runtime.dispose(); }
    }
});

test('固定资源下载接受压缩传输长度，但部署文件仍逐项真实SHA校验', async () => {
    await temporary(async directory => {
        const files = new Map(await Promise.all(assets.FILES.map(async file => [file.remote, await fs.readFile(path.join(localCache, file.name))])));
        const cacheRoot = path.join(directory, 'cache'), outputRoot = path.join(directory, 'output');
        const result = await assets.stageDepthAssets(outputRoot, { cacheRoot, preferredCacheRoot: null,
            fetchImpl: async url => {
                const key = new URL(url).pathname.split('/' + assets.REVISION + '/')[1];
                const bytes = files.get(key); assert.ok(bytes, key);
                return new Response(bytes, { headers: { 'content-encoding': 'gzip', 'content-length': '1' } });
            } });
        for (const file of assets.FILES) {
            const bytes = await fs.readFile(path.join(result.output, file.name));
            assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256);
        }
    });
});

test('资源准备无有效缓存明确拒绝；固定fallback不接main或任意URL，超过大小立即取消流且不留下下载文件', async () => {
    await temporary(async directory => {
        await assert.rejects(assets.stageDepthAssets(path.join(directory, 'no-assets'), { cacheRoot: path.join(directory, 'none'), preferredCacheRoot: null, allowDownload: false }), /本机深度资源/u);
        const cacheRoot = path.join(directory, 'oversize'); let cancelled = false, seenUrl = null;
        await assert.rejects(assets.stageDepthAssets(path.join(directory, 'no-download-output'), { cacheRoot, preferredCacheRoot: null,
            fetchImpl: async url => {
                seenUrl = url;
                const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(assets.MODELS[0].size + 1)); }, cancel() { cancelled = true; } });
                return new Response(stream);
            } }), /字节预算/u);
        assert.equal(seenUrl, `https://huggingface.co/${assets.REPOSITORY}/resolve/${assets.REVISION}/onnx/model_quantized.onnx`);
        assert.equal(cancelled, true); assert.deepEqual(await fs.readdir(cacheRoot), []);
    });
});
