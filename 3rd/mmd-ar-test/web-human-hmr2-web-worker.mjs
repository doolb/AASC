import { HMR_INPUT_SHAPES, prepareHmrWebInput, decodeHmrWebOutputs } from './web-human-hmr2-web-core.mjs';
import { HMR_WEB_BASE, probeHmrWebAssets, readHmrAsset, getHmrWebBackend } from './web-human-hmr2-web-resources.mjs';

let session = null, sessionBackend = null, ort = null, cv = null, busy = false, modelLoadMs = 0;
const progress = (id, message) => postMessage({ type: 'progress', id, message });
async function initialize(id, backend) {
    const config = getHmrWebBackend(backend);
    if (session) {
        if (sessionBackend !== backend) throw new Error('切换HMR后端必须重新创建Worker');
        return;
    }
    const start = performance.now(), state = await probeHmrWebAssets({ backend });
    if (!state.available) throw new Error(state.reason);
    progress(id, '正在加载HMR网页运行时…');
    ort = await import(new URL(config.entry, HMR_WEB_BASE).href);
    ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = HMR_WEB_BASE;
    await import(new URL('opencv.mjs', HMR_WEB_BASE).href);
    const candidate = globalThis.cv;
    cv = candidate instanceof Promise ? await candidate : candidate;
    if (!cv?.Mat) {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('HMR OpenCV初始化超时')), 30000);
            if (!cv) { clearTimeout(timer); reject(new Error('HMR OpenCV不可用')); return; }
            cv.onRuntimeInitialized = () => { clearTimeout(timer); resolve(); };
            cv.onAbort = () => { clearTimeout(timer); reject(new Error('HMR OpenCV初始化失败')); };
        });
    }
    const read = async name => {
        const file = state.manifest.files.find(entry => entry.name === name);
        return readHmrAsset(new URL(name, HMR_WEB_BASE), file, { progress: (bytes, total) => progress(id,
            `正在加载并校验HMR模型：${(bytes / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MiB`) });
    };
    let graph = await read('model.onnx'), weights = await read('model.onnx.data');
    progress(id, `正在初始化HMR ${config.label}模型，首次使用需要等待…`);
    try {
        session = await ort.InferenceSession.create(graph, { executionProviders: [backend], graphOptimizationLevel: 'all',
            externalData: [{ path: 'model.onnx.data', data: weights }], logSeverityLevel: 3 });
        modelLoadMs = performance.now() - start; sessionBackend = backend;
    } finally { graph = null; weights = null; }
}

globalThis.onmessage = async ({ data }) => {
    if (data?.type !== 'infer' || !Number.isSafeInteger(data.id)) return;
    const { id, backend = 'webgpu' } = data;
    if (busy) { postMessage({ type: 'error', id, message: 'HMR网页推理正在运行' }); return; }
    busy = true; let feeds = null, outputs = null;
    try {
        await initialize(id, backend);
        const start = performance.now(); progress(id, '正在预处理HMR图片…');
        const prepared = await prepareHmrWebInput(data.image, data.bbox, cv);
        const preprocessMs = performance.now() - start;
        feeds = Object.fromEntries(Object.entries(HMR_INPUT_SHAPES).map(([name, dims]) => [name, new ort.Tensor('float32', prepared.inputs[name], dims)]));
        progress(id, `正在浏览器${getHmrWebBackend(backend).label}计算HMR骨骼…`);
        const run = performance.now(); outputs = await session.run(feeds); const inferenceMs = performance.now() - run;
        const raw = decodeHmrWebOutputs(outputs, prepared.metadata, backend);
        raw.inferenceMs = inferenceMs; raw.modelLoadMs = modelLoadMs;
        raw.timingMs = { preprocess: preprocessMs, modelRun: inferenceMs, total: performance.now() - start };
        raw.runtime = { name: 'onnxruntime-web', version: '1.26.0', requestedEp: backend, actualAssignment: 'unknown', internalPrecision: 'unknown' };
        postMessage({ type: 'result', id, result: raw });
    } catch (error) {
        // 初始化和推理失败由客户端终止专用Worker，释放WASM、session及WebGPU资源。
        postMessage({ type: 'error', id, message: 'HMR网页推理失败：' + (typeof error?.message === 'string' ? error.message : '模型加载或运行失败') });
    } finally {
        for (const tensor of Object.values(outputs || {})) tensor.dispose();
        for (const tensor of Object.values(feeds || {})) tensor.dispose();
        busy = false;
    }
};
