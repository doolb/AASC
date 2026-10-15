import * as ort from './vendor/pose/ort.wasm.min.mjs';
import { prepareDetector, decodePerson, preparePose, decodePose } from './web-human-pose-core.mjs';

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
                progress(id, '初始化本地推理：' + (created.length ? '姿态' : '人物检测'));
                created.push(await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }));
            }
            if (created.length !== 2) throw new Error('姿态模型清单不匹配');
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
        const [detector, estimator] = await initialize(id), started = performance.now();
        progress(id, '本地识别人物…');
        const input = prepareDetector(image), detection = await run(detector, input.tensor, [1, 3, 224, 224]);
        let person;
        try { person = decodePerson(detection['Identity:0'].data, detection['Identity_1:0'].data, input); }
        finally { Object.values(detection).forEach(value => value.dispose()); }
        if (!person) throw new Error('未识别到人物，请使用清晰的单人全身图片');
        progress(id, '本地识别身体姿态…');
        const roi = preparePose(image, person), outputs = await run(estimator, roi.tensor, [1, 256, 256, 3]);
        let result;
        try { result = decodePose(outputs.Identity.data, outputs.Identity_4.data, outputs.Identity_1.data[0], roi, image); }
        finally { Object.values(outputs).forEach(value => value.dispose()); }
        result.inferenceMs = performance.now() - started;
        self.postMessage({ type: 'result', id, result });
    } catch (error) { self.postMessage({ type: 'error', id, message: error.message || String(error) }); }
};
