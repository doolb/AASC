import { validateHmrImage, validateHmrBox, HMR_OUTPUT_SHAPES, decodeHmrWebOutputs } from './web-human-hmr2-web-core.mjs';
import { createHmr2SemanticPose, HMR2_BODY25_NAMES, HMR2_BODY25_EDGES } from './web-human-pose-semantic.mjs';
import { probeHmrWebAssets, getHmrWebBackend } from './web-human-hmr2-web-resources.mjs';

function validateResult(raw, task) {
    if (!raw || raw.type !== 'hmr2.result' || raw.schemaVersion !== 1 || raw.source !== 'hmr2-web' || raw.model !== 'HMR2.0b'
        || raw.device !== getHmrWebBackend(task.backend).device || raw.precision !== 'fp32' || !Number.isFinite(raw.inferenceMs) || raw.inferenceMs < 0
        || JSON.stringify(raw.imageSize) !== JSON.stringify([task.width, task.height])
        || JSON.stringify(raw.boxXYXY) !== JSON.stringify(task.box) || raw.bboxSource !== task.bboxSource
        || JSON.stringify(raw.names) !== JSON.stringify(HMR2_BODY25_NAMES) || JSON.stringify(raw.edges) !== JSON.stringify(HMR2_BODY25_EDGES)) throw new Error('HMR网页结果与当前任务不匹配');
    const flatten = (value, shape) => {
        if (!shape.length) { if (!Number.isFinite(value)) throw new Error('HMR网页结果非有限'); return [value]; }
        if (!Array.isArray(value) || value.length !== shape[0]) throw new Error('HMR网页结果形状无效');
        return Array.from(value).flatMap(item => flatten(item, shape.slice(1)));
    };
    const values = { ...raw, focalLengthPx: [raw.projection?.focalLengthPx], principalPointPx: raw.projection?.principalPointPx };
    const tensors = Object.fromEntries(Object.entries(HMR_OUTPUT_SHAPES).map(([key, dims]) => [key,
        { type: 'float32', dims, data: Float32Array.from(flatten(values[key], dims.length === 1 ? dims : dims.slice(1))) }]));
    decodeHmrWebOutputs(tensors, raw, task.backend);
    return raw;
}

export function createHmrWebClient({ workerFactory = () => new Worker(new URL('./web-human-hmr2-web-worker.mjs', import.meta.url), { type: 'module' }),
    timeoutMs = 600000, probe = probeHmrWebAssets } = {}) {
    if (typeof workerFactory !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600000) throw new Error('HMR网页客户端配置无效');
    let worker = null, workerBackend = null, pending = null, serial = 0, disposed = false;
    const abort = () => new DOMException('HMR网页识别已取消', 'AbortError');
    function cancel(error = abort()) {
        const task = pending; pending = null; serial++;
        if (task) { clearTimeout(task.timer); task.reject(error); }
        const old = worker; worker = null; workerBackend = null;
        if (old) { old.onmessage = old.onerror = old.onmessageerror = null; old.terminate(); }
    }
    function startWorker(backend) {
        const active = workerFactory(); worker = active; workerBackend = backend;
        active.onmessage = ({ data }) => {
            if (worker !== active || !pending || data?.id !== pending.id) return;
            if (data.type === 'progress') { try { pending.progress(data.message); } catch { /* 进度显示失败不改变推理任务。 */ } return; }
            if (!['result', 'error'].includes(data.type)) return;
            const task = pending;
            try {
                if (data.type === 'error') throw new Error(data.message || 'HMR网页识别失败');
                const raw = validateResult(data.result, task), pose = createHmr2SemanticPose(raw, 'hmr2-web');
                pending = null; clearTimeout(task.timer); task.resolve({ candidates: [pose], inferenceMs: raw.inferenceMs, raw });
            } catch (error) { cancel(error); }
        };
        const failed = () => { if (worker === active) cancel(new Error('HMR网页Worker加载或传输失败，请重新构建网页')); };
        active.onerror = active.onmessageerror = failed;
    }
    async function infer(image, { bbox, backend = 'webgpu' } = {}, progress = () => {}) {
        if (disposed) throw new Error('HMR网页识别器已关闭');
        getHmrWebBackend(backend);
        if (pending || (worker && workerBackend !== backend)) cancel();
        const { width, height } = validateHmrImage(image), box = validateHmrBox(bbox, width, height);
        if (typeof progress !== 'function') throw new Error('HMR进度回调无效');
        if (!worker) startWorker(backend);
        return new Promise((resolve, reject) => {
            const id = ++serial;
            pending = { id, resolve, reject, progress, width, height, box, backend, bboxSource: bbox === undefined ? 'full_image_fallback' : 'supplied',
                timer: setTimeout(() => { if (pending?.id === id) cancel(new DOMException('HMR网页识别超时', 'TimeoutError')); }, timeoutMs) };
            try {
                const data = new Uint8ClampedArray(image.data);
                worker.postMessage({ type: 'infer', id, backend, image: { width, height, data }, bbox: bbox === undefined ? undefined : box }, [data.buffer]);
            } catch (error) { cancel(error); }
        });
    }
    return { infer, probe, cancel, dispose() { disposed = true; cancel(); } };
}
