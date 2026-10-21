'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { deflateSync, inflateSync } = require('node:zlib');

const BASE_URL = 'http://127.0.0.1:8768';
// 独立抄自实际Python wire，不能从被测模块取常量，否则左右标签错误会被测试共同掩盖。
const NAMES = ['nose', 'neck', 'right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder',
    'left_elbow', 'left_wrist', 'mid_hip', 'right_hip', 'right_knee', 'right_ankle', 'left_hip',
    'left_knee', 'left_ankle', 'right_eye', 'left_eye', 'right_ear', 'left_ear', 'left_big_toe',
    'left_small_toe', 'left_heel', 'right_big_toe', 'right_small_toe', 'right_heel'];
const EDGES = [[1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [10, 11],
    [8, 12], [12, 13], [13, 14], [0, 1], [0, 15], [0, 16], [15, 17], [16, 18],
    [11, 22], [22, 23], [11, 24], [14, 19], [19, 20], [14, 21]];
const KEYS = ['leftArm', 'rightArm', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist',
    'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'];
const MP_INDICES = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const HMR_INDICES = [5, 2, 6, 3, 7, 4, 12, 9, 13, 10, 14, 11];
const load = async () => await import('../3rd/mmd-ar-test/web-human-hmr2-client.mjs');
const semantic = async () => await import('../3rd/mmd-ar-test/web-human-pose-semantic.mjs');
const image = (width = 100, height = 80) => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(137) });
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return payload; } });
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, bytes) {
    const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([size, name, bytes, crc]);
}
// 真PNG用于检查注入点及默认浏览器画布路径，不把任意abc字节冒充可上传图片。
function png(source) {
    const header = Buffer.alloc(13); header.writeUInt32BE(source.width); header.writeUInt32BE(source.height, 4);
    header[8] = 8; header[9] = 6;
    const rows = Buffer.alloc(source.height * (source.width * 4 + 1));
    for (let row = 0; row < source.height; row++) {
        rows.set(source.data.subarray(row * source.width * 4, (row + 1) * source.width * 4), row * (source.width * 4 + 1) + 1);
    }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
}
function nativeResult(source = image(), bbox) {
    const [width, height] = [source.width, source.height], focal = Math.max(width, height);
    const xyz = Array.from({ length: 25 }, (_, i) => [(i - 12) * .02, (i - 12) * .015, i * .003]);
    const cameraTranslation = [.05, -.1, 5];
    const cameraDepth = xyz.map(point => point[2] + cameraTranslation[2]);
    const xy = xyz.map((point, i) => [focal * (point[0] + cameraTranslation[0]) / cameraDepth[i] + width / 2,
        focal * (point[1] + cameraTranslation[1]) / cameraDepth[i] + height / 2]);
    return { type: 'hmr2.result', schemaVersion: 1, model: 'HMR2.0b',
        source: 'official 4D-Humans checkpoint; embedded SMPL buffers via smplx.lbs',
        device: 'cuda:0', gpu: { index: 0, name: 'NVIDIA GeForce GTX 1660' }, precision: 'fp32',
        imageSize: [width, height], boxXYXY: bbox || [0, 0, width, height], bboxSource: bbox ? 'supplied' : 'full_image_fallback',
        names: [...NAMES], edges: structuredClone(EDGES), xyz, xy, cameraDepth,
        rotations24: Array.from({ length: 24 }, () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]]), betas10: Array(10).fill(.1),
        predCam: [.8, .01, -.02], cameraTranslation,
        projection: { focalLengthPx: focal, principalPointPx: [width / 2, height / 2] },
        camera: { translation: [...cameraTranslation], focalLengthPx: focal, principalPoint: [width / 2, height / 2] },
        inputTensorSha256: 'a'.repeat(64), modelLoadMs: 2000, inferenceMs: 300,
        timingMs: { preprocess: 5, hostToDevice: 2, network: 250, lbs: 50, projection: 1, deviceToHost: 1, total: 309, modelLoad: 2000 },
        memory: { allocatedMiB: 2689, reservedMiB: 2800, peakAllocatedMiB: 2700, peakReservedMiB: 2800,
            deviceFreeMiB: 3000, deviceTotalMiB: 6144 } };
}
function nativeHealth(ready = true) {
    return { type: 'hmr2.health', ready, model: 'HMR2.0b', device: ready ? 'cuda:0' : null,
        gpu: 0, precision: 'fp32', loadCount: ready ? 1 : 0, busy: false, modelLoadMs: ready ? 2000 : 0, memory: null };
}

// 全部请求使用注入fetch，不监听任何端口，不探测/启动/停止用户的GPU服务。
test('服务根地址规范HTTP(S)、IPv6及代理路径，拒绝协议/账户/查询串/片段', async () => {
    const { normalizeHmr2BaseUrl } = await load();
    for (const [input, expected] of [[' HTTP://LOCALHOST:8768/// ', BASE_URL.replace('127.0.0.1', 'localhost')],
        ['https://EXAMPLE.COM:443/hmr/', 'https://example.com/hmr'], ['http://[::1]:8768/', 'http://[::1]:8768']]) {
        assert.equal(normalizeHmr2BaseUrl(input), expected);
    }
    for (const value of ['', null, 'localhost:8768', '//localhost:8768', 'file:///tmp', 'ftp://host',
        'http://user:pass@host', 'http://host?x=1', 'http://host?', 'http://host#token', 'http://host/#',
        'http://host/a b', 'http:\\host', 'http://host/\npath', 'http://host:70000']) {
        assert.throws(() => normalizeHmr2BaseUrl(value), error => error.code === 'invalid_base_url');
    }
});

test('GET health不编码、不上传，Bearer仅请求会话，未ready和busy可明确返回', async () => {
    const { createHmr2PoseClient } = await load();
    const requests = [], health = nativeHealth(); health.busy = true;
    const client = createHmr2PoseClient({ encodeImage() { throw new Error('不应编码'); },
        fetchImpl: async (url, options) => { requests.push({ url, options }); return response(health); } });
    assert.equal(await client.testConnection({ baseUrl: BASE_URL + '/', token: '  session-key  ' }), health);
    assert.equal(requests[0].url, BASE_URL + '/health'); assert.equal(requests[0].options.method, 'GET');
    assert.equal(requests[0].options.body, undefined); assert.equal(requests[0].options.headers.Authorization, 'Bearer session-key');
    assert.equal(requests[0].options.headers['Content-Type'], undefined);
    assert.equal(requests[0].options.credentials, 'omit'); assert.equal(requests[0].options.redirect, 'error');
    await client.testConnection({ baseUrl: BASE_URL }); assert.equal(requests[1].options.headers.Authorization, undefined);
    const cold = createHmr2PoseClient({ fetchImpl: async () => response(nativeHealth(false)) });
    assert.equal((await cold.testConnection({ baseUrl: BASE_URL })).ready, false);
    client.dispose(); cold.dispose();
});

test('health严格校验实际基本协议，不虚构版本或limits', async t => {
    const { createHmr2PoseClient } = await load();
    for (const [field, value] of [['type', 'depth.health'], ['ready', 1], ['model', 'other'], ['precision', 'fp16'], ['device', 'cpu'], ['busy', 'yes']]) {
        await t.test(field, async () => {
            const bad = nativeHealth(); bad[field] = value;
            const client = createHmr2PoseClient({ fetchImpl: async () => response(bad) });
            await assert.rejects(client.testConnection({ baseUrl: BASE_URL }), error => error.code === 'invalid_health'); client.dispose();
        });
    }
});

test('POST只发送实际image_base64/bbox_xyxy，保留native raw且不伪造MP33或置信度', async () => {
    const { createHmr2PoseClient } = await load(), s = await semantic();
    const source = image(), box = [2.5, 3, 95, 76], raw = nativeResult(source, box);
    raw.extraNativeDiagnostic = { kept: true };
    const saved = structuredClone(source), rawSaved = structuredClone(raw), calls = [], progress = [];
    const client = createHmr2PoseClient({ encodeImage: png, fetchImpl: async (url, options) => {
        calls.push({ url, options }); return response(raw);
    } });
    const result = await client.infer(source, { baseUrl: BASE_URL, token: 'key', bbox: box, unknown: '不得发送' }, message => progress.push(message));
    const call = calls[0], payload = JSON.parse(call.options.body), pose = result.candidates[0];
    assert.equal(call.url, BASE_URL + '/infer'); assert.equal(call.options.method, 'POST');
    assert.deepEqual(Object.keys(payload).sort(), ['bbox_xyxy', 'image_base64']); assert.deepEqual(payload.bbox_xyxy, box);
    assert.deepEqual(Buffer.from(payload.image_base64, 'base64'), png(source));
    assert.equal(call.options.headers['Content-Type'], 'application/json'); assert.equal(call.options.headers.Authorization, 'Bearer key');
    assert.ok(!Object.keys(call.options.headers).some(key => key.toLowerCase() === 'content-length'));
    assert.ok(call.options.signal instanceof AbortSignal); assert.equal(result.inferenceMs, 300);
    assert.equal(pose.source, 'hmr2-api'); assert.equal(pose.dimensions, 3); assert.equal(pose.imageAspect, 1.25);
    assert.equal(pose.raw, raw); assert.deepEqual(raw, rawSaved); assert.deepEqual(source, saved);
    assert.equal(pose.landmarks, undefined); assert.equal(pose.confidence, undefined); assert.equal(pose.visibility, undefined);
    assert.deepEqual(Object.keys(pose.joints), [...KEYS, 'hips', 'neck', 'head']);
    for (let i = 0; i < KEYS.length; i++) {
        const point = s.getPosePoint(pose, KEYS[i]), index = HMR_INDICES[i];
        assert.deepEqual(point.world, raw.xyz[index]); assert.equal(point.x, raw.xy[index][0] / source.width);
        assert.equal(point.y, raw.xy[index][1] / source.height); assert.equal(point.weight, 1); assert.equal(point.usable, true);
        assert.equal(point.confidence, undefined); assert.equal(point.visibility, undefined);
    }
    assert.deepEqual(pose.quality, { torsoReady: true, visible: 12, lowConfidence: [] });
    assert.equal(pose.joints.hips.x, raw.xy[8][0] / source.width); assert.equal(pose.joints.neck.y, raw.xy[1][1] / source.height);
    assert.deepEqual(pose.joints.head.world, raw.xyz[0]); assert.ok(!s.POSE_BODY_KEYS.includes('head'));
    assert.equal(progress.length, 3); assert.ok(progress.every(value => !value.includes('key')));
    client.dispose();
});

test('无bbox省略字段；出画点保持XY/XYZ、不裁边、不改左右，质量列表用语义键', async () => {
    const { createHmr2PoseClient } = await load();
    const source = image(80, 120), raw = nativeResult(source);
    raw.xy[5] = [-12, 120]; raw.xy[7] = [80, 121]; raw.xyz[7] = [-.7, 1.2, .4];
    let payload;
    const client = createHmr2PoseClient({ encodeImage: png, fetchImpl: async (url, options) => {
        payload = JSON.parse(options.body); return response(raw);
    } });
    const { candidates: [pose] } = await client.infer(source, { baseUrl: BASE_URL });
    assert.deepEqual(Object.keys(payload), ['image_base64']); assert.equal(pose.imageAspect, 2 / 3);
    assert.equal(pose.joints.leftArm.x, -.15); assert.equal(pose.joints.leftArm.y, 1); assert.equal(pose.joints.leftArm.usable, false);
    assert.equal(pose.joints.leftWrist.y, 121 / 120); assert.deepEqual(pose.joints.leftWrist.world, [-.7, 1.2, .4]);
    assert.deepEqual(pose.quality, { torsoReady: false, visible: 10, lowConfidence: ['leftArm', 'leftWrist'] });
    assert.deepEqual(pose.raw.xy[5], [-12, 120]); client.dispose();
});

test('人物框只接收同图有限xyxy，非法输入不编码也不fetch；token不进入消息', async () => {
    const { createHmr2PoseClient } = await load(); let calls = 0;
    const client = createHmr2PoseClient({ encodeImage() { calls++; }, fetchImpl: async () => { calls++; } });
    for (const bbox of [null, [], [0, 0, 0, 80], [2, 2, 1, 3], [-1, 0, 50, 80], [0, 0, 101, 80],
        [0, 0, 100, 81], [0, 0, Infinity, 80], [false, 0, 100, 80], ['0', 0, 100, 80], { x: 0, y: 0, w: 100, h: 80 }]) {
        await assert.rejects(client.infer(image(), { baseUrl: BASE_URL, bbox }), error => error.code === 'invalid_bbox');
    }
    for (const token of ['my\nprivate-secret', 'secret\r\nInjected:value', 'Bearer secret', '中', 42, 'x'.repeat(4097)]) {
        await assert.rejects(client.testConnection({ baseUrl: BASE_URL, token }), error => error.code === 'invalid_token' && !error.message.includes('secret'));
    }
    for (const source of [null, { width: true, height: 1, data: [] }, { width: 1, height: 1, data: [0, 0, 0] },
        { width: 1, height: 1, data: [0, 0, 0, NaN] }, { width: 10001, height: 4000, data: [] }]) {
        await assert.rejects(client.infer(source, { baseUrl: BASE_URL }), error => ['invalid_image', 'image_too_large'].includes(error.code));
    }
    assert.equal(calls, 0); client.dispose();
});

test('结构化HTTP错误保留实际status/code/message，并区分503 gpu_busy及不可重试鉴权', async t => {
    const { createHmr2PoseClient } = await load();
    for (const [status, code] of [[400, 'invalid_bbox'], [401, 'unauthorized'], [413, 'image_too_large'], [503, 'gpu_busy'], [503, 'resources_missing']]) {
        await t.test(`${status} ${code}`, async () => {
            const client = createHmr2PoseClient({ encodeImage: png, fetchImpl: async () => response({ error: { status, code, message: '明确业务错误' } }, status) });
            await assert.rejects(client.infer(image(), { baseUrl: BASE_URL }), error => {
                assert.equal(error.name, 'Hmr2ClientError'); assert.equal(error.code, code); assert.equal(error.status, status);
                assert.equal(error.message, '明确业务错误'); assert.equal(error.retryable, status === 503); return true;
            }); client.dispose();
        });
    }
});

test('网络/坏JSON/非JSON HTTP失败都返回结构化错误，不回显原始敏感异常', async () => {
    const { createHmr2PoseClient } = await load();
    const network = createHmr2PoseClient({ fetchImpl: async () => { throw new Error('private-secret'); } });
    await assert.rejects(network.testConnection({ baseUrl: BASE_URL, token: 'private-secret' }), error => error.code === 'network_error' && !error.message.includes('private-secret'));
    network.dispose();
    for (const [status, code] of [[200, 'invalid_json'], [502, 'http_error']]) {
        const client = createHmr2PoseClient({ fetchImpl: async () => ({ ok: status === 200, status, async json() { throw new SyntaxError('bad'); } }) });
        await assert.rejects(client.testConnection({ baseUrl: BASE_URL }), error => error.code === code && error.status === 502); client.dispose();
    }
    const nested = createHmr2PoseClient({ fetchImpl: async () => response({ error: { status: 503, code: 'gpu_busy', message: '忙' } }) });
    await assert.rejects(nested.testConnection({ baseUrl: BASE_URL }), error => error.status === 503 && error.code === 'gpu_busy'); nested.dispose();
});

test('实际完整result严格拒绝错版本、名字、shape、有限性、正深度、相机/尺寸/框/来源', async t => {
    const { createHmr2PoseClient } = await load();
    const changes = {
        type: raw => { raw.type = 'pose.result'; }, schemaVersion: raw => { raw.schemaVersion = 2; },
        model: raw => { raw.model = 'other'; }, source: raw => { raw.source = 'unverified'; }, precision: raw => { raw.precision = 'fp16'; },
        device: raw => { raw.device = 'cpu'; }, gpu: raw => { raw.gpu.index = 1; }, imageSize: raw => { raw.imageSize.reverse(); },
        names: raw => { [raw.names[2], raw.names[5]] = [raw.names[5], raw.names[2]]; }, duplicateNames: raw => { raw.names[1] = 'nose'; },
        edges: raw => { raw.edges[0][1] = 25; }, xyzShape: raw => { raw.xyz.pop(); }, xyShape: raw => { raw.xy[0].push(0); },
        xyzFinite: raw => { raw.xyz[2][1] = Infinity; }, xyFinite: raw => { raw.xy[0][0] = NaN; },
        cameraDepth: raw => { raw.cameraDepth[3] = 0; }, negativeDepth: raw => { raw.cameraDepth[3] = -1; },
        missingDepth: raw => { raw.cameraDepth.pop(); }, rotations24: raw => { raw.rotations24[0][1].pop(); },
        betas10: raw => { raw.betas10[0] = null; }, predCam: raw => { raw.predCam = [1, 2]; },
        cameraTranslation: raw => { raw.cameraTranslation[2] = 0; }, projection: raw => { raw.projection.focalLengthPx = -1; },
        principalPoint: raw => { raw.projection.principalPointPx[0]++; }, camera: raw => { raw.camera.translation[0]++; },
        boxXYXY: raw => { raw.boxXYXY[2]--; }, bboxSource: raw => { raw.bboxSource = 'supplied'; },
        inferenceMs: raw => { raw.inferenceMs = -1; }, timingMs: raw => { raw.timingMs.network = '250'; },
        memory: raw => { raw.memory.deviceFreeMiB = Infinity; }, digest: raw => { raw.inputTensorSha256 = 'notsha'; },
        oldWire: raw => { raw.xyz25 = raw.xyz; delete raw.xyz; },
    };
    for (const [field, mutate] of Object.entries(changes)) await t.test(field, async () => {
        const raw = nativeResult(); mutate(raw);
        const client = createHmr2PoseClient({ encodeImage: png, fetchImpl: async () => response(raw) });
        await assert.rejects(client.infer(image(), { baseUrl: BASE_URL }), error => error.code === 'invalid_result' && error.status === 502);
        client.dispose();
    });
});

test('PNG编码器支持bytes/ArrayBuffer/Blob/base64，尺寸/格式无效及16MiB超限不上传', async () => {
    const { createHmr2PoseClient } = await load(), source = image();
    const bytes = png(source);
    for (const encoded of [bytes, Uint8Array.from(bytes).buffer, new Blob([bytes], { type: 'image/png' }),
        bytes.toString('base64'), 'data:image/png;base64,' + bytes.toString('base64')]) {
        const client = createHmr2PoseClient({ encodeImage: async () => encoded, fetchImpl: async () => response(nativeResult(source)) });
        assert.equal((await client.infer(source, { baseUrl: BASE_URL })).candidates.length, 1); client.dispose();
    }
    let fetchCount = 0;
    for (const [encoded, code] of [[png(image(1, 1)), 'encode_failed'], [new Uint8Array([1, 2, 3]), 'encode_failed'],
        [new Blob([bytes], { type: 'image/jpeg' }), 'encode_failed'], ['data:image/jpeg;base64,' + bytes.toString('base64'), 'encode_failed'],
        ['%%%notbase64', 'encode_failed'], [new Uint8Array(16 * 1024 * 1024 + 1), 'image_too_large'],
        [new Blob([new Uint8Array(16 * 1024 * 1024 + 1)], { type: 'image/png' }), 'image_too_large']]) {
        const client = createHmr2PoseClient({ encodeImage: async () => encoded, fetchImpl: async () => { fetchCount++; } });
        await assert.rejects(client.infer(source, { baseUrl: BASE_URL }), error => error.code === code); client.dispose();
    }
    assert.equal(fetchCount, 0);
    const boundary = new Uint8Array(16 * 1024 * 1024); boundary.set(bytes);
    const exact = createHmr2PoseClient({ encodeImage: async () => boundary, fetchImpl: async (url, options) => {
        assert.equal(Buffer.from(JSON.parse(options.body).image_base64, 'base64').length, 16 * 1024 * 1024);
        return response(nativeResult(source));
    } });
    await exact.infer(source, { baseUrl: BASE_URL }); exact.dispose();
});

test('默认浏览器画布真正从ImageData准备PNG，并在编码后释放画布', async () => {
    const { createHmr2PoseClient } = await load(), source = image(3, 2);
    const before = { canvas: globalThis.OffscreenCanvas, imageData: globalThis.ImageData };
    let scratch, pixels;
    try {
        globalThis.ImageData = class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
        globalThis.OffscreenCanvas = class {
            constructor(width, height) { this.width = width; this.height = height; scratch = this; }
            getContext(type) { assert.equal(type, '2d'); return { putImageData(data) { pixels = data; } }; }
            async convertToBlob(options) { assert.deepEqual(options, { type: 'image/png' }); return new Blob([png(pixels)], { type: 'image/png' }); }
        };
        const client = createHmr2PoseClient({ fetchImpl: async (url, options) => {
            const encoded = Buffer.from(JSON.parse(options.body).image_base64, 'base64');
            const length = encoded.readUInt32BE(33); const rows = inflateSync(encoded.subarray(41, 41 + length));
            assert.deepEqual([...rows.subarray(1, 13)], [...source.data.subarray(0, 12)]);
            return response(nativeResult(source));
        } });
        await client.infer(source, { baseUrl: BASE_URL }); assert.notEqual(pixels.data, source.data);
        assert.equal(scratch.width, 0); assert.equal(scratch.height, 0); client.dispose();
    } finally {
        if (before.canvas === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = before.canvas;
        if (before.imageData === undefined) delete globalThis.ImageData; else globalThis.ImageData = before.imageData;
    }
});

test('cancel在编码中立即Abort，不等无视signal的编码器；迟到编码不能上传', async () => {
    const { createHmr2PoseClient } = await load(), encoding = deferred(), started = deferred(); let signal, calls = 0;
    const source = image(), saved = structuredClone(source), messages = [];
    const client = createHmr2PoseClient({ encodeImage: async (snapshot, options) => {
        signal = options.signal; assert.notEqual(snapshot.data, source.data); started.resolve(); return await encoding.promise;
    }, fetchImpl: async () => { calls++; } });
    const inference = client.infer(source, { baseUrl: BASE_URL }, message => messages.push(message));
    const rejected = assert.rejects(inference, error => error.name === 'AbortError' && error.code === 'cancelled');
    await started.promise; client.cancel(); await rejected; assert.equal(signal.aborted, true);
    encoding.resolve(png(saved)); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0); assert.equal(messages.length, 1); assert.deepEqual(source, saved); client.dispose();
});

test('单飞新infer取消旧fetch，新结果成功，旧fetch迟到不污染结果或进度', async () => {
    const { createHmr2PoseClient } = await load(), firstResponse = deferred(), started = deferred();
    const signals = [], oldProgress = [], raw = nativeResult(); let calls = 0;
    const client = createHmr2PoseClient({ encodeImage: png, fetchImpl: async (url, options) => {
        signals.push(options.signal); calls++;
        if (calls === 1) { started.resolve(); return await firstResponse.promise; }
        return response(raw);
    } });
    const old = client.infer(image(), { baseUrl: BASE_URL }, value => oldProgress.push(value));
    const rejected = assert.rejects(old, { name: 'AbortError', code: 'cancelled' }); await started.promise;
    const result = await client.infer(image(), { baseUrl: BASE_URL }); await rejected;
    assert.equal(result.candidates[0].raw, raw); assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
    firstResponse.resolve(response(nativeResult())); await new Promise(resolve => setImmediate(resolve));
    assert.equal(oldProgress.length, 2); assert.equal(calls, 2); client.dispose();
});

test('health与infer共用单飞；取消response.json等待；dispose幂等且阻止所有新请求', async () => {
    const { createHmr2PoseClient } = await load(), body = deferred(), started = deferred(); let signal;
    const client = createHmr2PoseClient({ encodeImage: png, fetchImpl: async (url, options) => {
        if (url.endsWith('/health')) return response(nativeHealth());
        signal = options.signal;
        return { ok: true, status: 200, async json() { started.resolve(); return await body.promise; } };
    } });
    const old = client.infer(image(), { baseUrl: BASE_URL }); const rejected = assert.rejects(old, { name: 'AbortError' });
    await started.promise; assert.equal((await client.testConnection({ baseUrl: BASE_URL })).ready, true); await rejected;
    assert.equal(signal.aborted, true); body.resolve(nativeResult()); await new Promise(resolve => setImmediate(resolve));
    client.dispose(); client.dispose(); client.cancel();
    await assert.rejects(client.infer(image(), { baseUrl: BASE_URL }), error => error.code === 'disposed');
    await assert.rejects(client.testConnection({ baseUrl: BASE_URL }), error => error.code === 'disposed');
});

test('超时AbortController中止health/PNG/HTTP等待并可重试；不冒充普通取消', async () => {
    const { createHmr2PoseClient } = await load();
    for (const mode of ['health', 'encode', 'infer']) {
        let signal;
        const client = createHmr2PoseClient({ timeoutMs: 10,
            encodeImage: mode === 'encode' ? async (source, options) => { signal = options.signal; return await new Promise(() => {}); } : png,
            fetchImpl: async (url, options) => { signal = options.signal; return await new Promise(() => {}); } });
        const pending = mode === 'health' ? client.testConnection({ baseUrl: BASE_URL }) : client.infer(image(), { baseUrl: BASE_URL });
        await assert.rejects(pending, error => error.name === 'TimeoutError' && error.code === 'timeout' && error.retryable);
        assert.equal(signal.aborted, true); client.dispose();
    }
});

test('调用者改像素不会改变异步上传快照；进度回调取消后不继续编码', async () => {
    const { createHmr2PoseClient } = await load(), source = image(), started = deferred(), gate = deferred();
    const saved = png(source); let uploaded;
    const client = createHmr2PoseClient({ encodeImage: async snapshot => { started.resolve(); await gate.promise; return png(snapshot); },
        fetchImpl: async (url, options) => { uploaded = Buffer.from(JSON.parse(options.body).image_base64, 'base64'); return response(nativeResult(source)); } });
    const pending = client.infer(source, { baseUrl: BASE_URL }); await started.promise; source.data.fill(0); gate.resolve(); await pending;
    assert.deepEqual(uploaded, saved); client.dispose();
    let encoded = false;
    const cancelled = createHmr2PoseClient({ encodeImage() { encoded = true; }, fetchImpl: async () => {} });
    await assert.rejects(cancelled.infer(image(), { baseUrl: BASE_URL }, () => cancelled.cancel()), { name: 'AbortError' });
    assert.equal(encoded, false); cancelled.dispose();
});

test('统一语义MP编号、旧quality兼容与二维相机参考无需world，损坏world仍拒绝', async () => {
    const { POSE_BODY_KEYS, getPosePoint, getPoseQuality, getPoseReference } = await semantic();
    assert.deepEqual([...POSE_BODY_KEYS], KEYS);
    const landmarks = Array.from({ length: 33 }, (_, i) => ({ x: .1 + i / 100, y: .2 + i / 100, visibility: .9, presence: .8 }));
    const pose = { landmarks }, saved = structuredClone(pose);
    for (let i = 0; i < KEYS.length; i++) {
        const point = getPosePoint(pose, KEYS[i]); assert.equal(point.x, landmarks[MP_INDICES[i]].x);
        assert.equal(point.weight, .8); assert.equal(point.usable, true); assert.equal(point.world, undefined);
    }
    assert.deepEqual(pose, saved); assert.equal(getPosePoint(pose, 'unknown'), null); assert.equal(getPosePoint(null, 'leftArm'), null);
    assert.deepEqual(getPoseQuality(pose), { total: 12, visible: 12, lowConfidence: [], torsoReady: true });
    pose.quality = { score: .72, total: 12, visible: 11, lowConfidence: [13], torsoReady: true };
    assert.deepEqual(getPoseQuality(pose), { score: .72, total: 12, visible: 11, lowConfidence: ['leftElbow'], torsoReady: true });
    delete pose.quality;
    for (const world of [[0, NaN, 1], [0, 0], null, 4, 'bad']) {
        landmarks[11].world = world; assert.equal(getPosePoint(pose, 'leftArm').usable, false);
    }
    delete landmarks[11].world; landmarks[11].presence = .4;
    assert.equal(getPosePoint(pose, 'leftArm').usable, false);
    assert.deepEqual(getPoseQuality(pose).lowConfidence, ['leftArm']);
    const reference = getPoseReference(pose); assert.equal(reference.points.length, 33);
    assert.deepEqual(reference.edges, [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24],
        [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 7], [0, 8]]);
    assert.equal(reference.points[13].key, 'leftElbow'); assert.equal(reference.points[0].key, 'head');
    assert.equal(getPosePoint({ source: 'rtmpose-m', dimensions: 2, landmarks }, 'leftArm').usable, true);
});

test('编码/网络抛出非Error或DOMException仍结构化，不把编码错误说成网络错误', async () => {
    const { createHmr2PoseClient } = await load();
    for (const value of [null, undefined, new DOMException('不可序列化画布', 'InvalidStateError')]) {
        const client = createHmr2PoseClient({ encodeImage: async () => { throw value; }, fetchImpl: async () => {} });
        await assert.rejects(client.infer(image(), { baseUrl: BASE_URL }), error => error.code === 'encode_failed'); client.dispose();
    }
    const network = createHmr2PoseClient({ fetchImpl: async () => { throw null; } });
    await assert.rejects(network.testConnection({ baseUrl: BASE_URL }), error => error.code === 'network_error'); network.dispose();
    const empty = createHmr2PoseClient({ encodeImage: async () => '', fetchImpl: async () => {} });
    await assert.rejects(empty.infer(image(), { baseUrl: BASE_URL }), error => error.code === 'encode_failed'); empty.dispose();
});

test('dispose直接取消活动health；超时后同一客户端可以重试而不被旧任务清空', async () => {
    const { createHmr2PoseClient } = await load(), started = deferred(); let signal;
    const disposed = createHmr2PoseClient({ fetchImpl: async (url, options) => {
        signal = options.signal; started.resolve(); return await new Promise(() => {});
    } });
    const pending = disposed.testConnection({ baseUrl: BASE_URL });
    const rejected = assert.rejects(pending, error => error.name === 'AbortError' && error.code === 'cancelled');
    await started.promise; disposed.dispose(); await rejected; assert.equal(signal.aborted, true);
    await assert.rejects(disposed.testConnection({ baseUrl: BASE_URL }), error => error.code === 'disposed');
    let calls = 0;
    const retry = createHmr2PoseClient({ timeoutMs: 10, fetchImpl: async () => {
        calls++; if (calls === 1) return await new Promise(() => {}); return response(nativeHealth());
    } });
    await assert.rejects(retry.testConnection({ baseUrl: BASE_URL }), error => error.code === 'timeout');
    assert.equal((await retry.testConnection({ baseUrl: BASE_URL })).ready, true); assert.equal(calls, 2); retry.dispose();
});

test('HMR预览保留BODY25原生脚趾边和nose参考，非正深度/出画不可用且不改数据', async () => {
    const s = await semantic(), raw = nativeResult();
    assert.deepEqual([...s.HMR2_BODY25_NAMES], NAMES); assert.deepEqual(s.HMR2_BODY25_EDGES, EDGES);
    raw.cameraDepth[7] = -1; raw.xy[2][0] = -2;
    const saved = structuredClone(raw), pose = s.createHmr2SemanticPose(raw), reference = s.getPoseReference(pose);
    assert.equal(reference.points.length, 25); assert.deepEqual(reference.edges, EDGES);
    assert.equal(reference.points[0].key, 'head'); assert.equal(reference.points[22].key, 'right_big_toe');
    assert.equal(reference.points[7].usable, false); assert.equal(reference.points[2].usable, false);
    assert.equal(s.getPosePoint(pose, 'leftWrist').usable, false); assert.equal(s.getPosePoint(pose, 'leftWrist').weight, 1);
    assert.deepEqual(raw, saved); assert.deepEqual(s.getPoseQuality(pose).lowConfidence, ['rightArm', 'leftWrist']);
    assert.equal(s.POSE_BODY_KEYS.includes('head'), false); assert.equal(s.POSE_BODY_KEYS.includes('neck'), false);
    raw.edges.push([0, 25], ['1', 2], [1, 1]); assert.deepEqual(s.getPoseReference(pose).edges, EDGES);
});
