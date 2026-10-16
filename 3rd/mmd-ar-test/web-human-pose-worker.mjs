import * as ort from './vendor/pose/ort.wasm.min.mjs';
import { prepareRTMPose, decodeRTMPose } from './web-human-pose-rtmpose.mjs';

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('./vendor/pose/', import.meta.url).href;
let sessions = null, loading = null;
const progress = (id, message) => self.postMessage({ type: 'progress', id, message });
async function loadModel(file, id) {
    const url = new URL('./vendor/pose/' + file.name + '?sha256=' + file.sha256, import.meta.url).href;
    let cache;
    try { cache = await caches.open('mmd-image-pose-v1'); } catch (error) { /* HTTP或存储受限仍允许本次内存推理。 */ }
    const cached = await cache?.match(url);
    if (cached) {
        const bytes = await cached.arrayBuffer();
        if (bytes.byteLength === file.size) return bytes;
        await cache.delete(url);
    }
    progress(id, '准备模型：' + file.name);
    const response = await fetch(url);
    if (!response.ok) throw new Error('姿态模型读取失败：HTTP ' + response.status);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== file.size) throw new Error('姿态模型不完整，请重试');
    try { await cache?.put(url, new Response(bytes.slice(0))); } catch (error) { /* 缓存配额不足不阻止识别。 */ }
    return bytes;
}
async function initialize(id) {
    if (sessions) return sessions;
    if (!loading) loading = (async () => {
        const response = await fetch(new URL('./vendor/pose/models.json', import.meta.url));
        if (!response.ok) throw new Error('缺少姿态模型清单，请重新构建网页');
        const manifest = await response.json(), created = [];
        try {
            for (const model of manifest.models) {
                const bytes = await loadModel(model, id);
                progress(id, '初始化本地推理：RTMPose-m（约52.3MiB）');
                created.push(await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }));
            }
            if (created.length !== 1 || manifest.models[0].name !== 'rtmpose-m-body7-384x288.onnx') throw new Error('姿态模型清单不匹配');
            sessions = created; return sessions;
        } catch (error) { for (const session of created) await session.release(); throw error; }
    })().catch(error => { loading = null; throw error; });
    return loading;
}
async function run(session, data, dims) {
    const input = new ort.Tensor('float32', data, dims);
    try { return await session.run({ [session.inputNames[0]]: input }); }
    finally { input.dispose(); }
}
self.onmessage = async event => {
    const { id, image } = event.data;
    try {
        const [estimator] = await initialize(id), started = performance.now();
        progress(id, 'RTMPose-m本地识别单人全图…');
        const roi = prepareRTMPose(image), outputs = await run(estimator, roi.tensor, [1, 3, 384, 288]);
        let pose;
        try {
            // 同时核查真实输出名称与维度，不依赖对象枚举顺序猜测横纵坐标。
            pose = decodeRTMPose(outputs.simcc_x, outputs.simcc_y, roi, image);
        } finally { Object.values(outputs).forEach(value => value.dispose()); }
        const result = { ...pose, candidates: [pose], inferenceMs: performance.now() - started };
        self.postMessage({ type: 'result', id, result });
    } catch (error) { self.postMessage({ type: 'error', id, message: error.message || String(error) }); }
};
