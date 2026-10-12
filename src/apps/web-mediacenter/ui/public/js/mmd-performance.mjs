import { createGpuRenderTimer } from './mmd-gpu-timer.mjs';

/*
 * 两端共用的帧统计：只采样现有绘制/物理调用，不另开渲染循环。
 * FPS使用实际帧间隔；CPU提交与异步GPU执行分别统计，不相加为总帧时间。
 */
const physicsTimings = new WeakMap();
const emptySnapshot = (gpuStatus = 'unsupported') => ({ running: false, ready: false, fps: null, renderMs: null,
    gpuRenderMs: null, gpuStatus, physicsMs: 0, physicsRunning: false });
const milliseconds = value => Number.isFinite(value) ? Math.max(0, value) : 0;

export function instrumentPhysics(physics, now = () => performance.now()) {
    if (!physics || typeof physics.update !== 'function' || physicsTimings.has(physics)) return;
    const timing = { sequence: 0, frameMs: 0 };
    const update = physics.update;
    physics.update = function measuredPhysicsUpdate(...args) {
        const started = now();
        try { return update.apply(this, args); }
        finally {
            timing.frameMs = milliseconds(now() - started);
            timing.sequence += 1;
            this.frameMs = timing.frameMs;
        }
    };
    physicsTimings.set(physics, timing);
}

// 只返回序号和值，调用者无法改写实例的统计状态。
export const getPhysicsTiming = physics => {
    const timing = physics && physicsTimings.get(physics);
    return timing ? { ...timing } : { sequence: 0, frameMs: 0 };
};

export function createFramePerformance({ onUpdate = () => {}, documentRef = globalThis.document,
    intervalMs = 500, gpuTimer = null, canvasRef = null } = {}) {
    const gpuState = () => gpuTimer?.getState() || { status: 'unsupported', generation: 0 };
    let snapshot = emptySnapshot(gpuState().status), disposed = false, gpuBatch = null;
    let gpuGeneration = gpuState().generation, gpuTotal = 0, gpuSamples = 0;
    let lastAt = null, elapsedMs = 0, intervals = 0, samples = 0, renderTotal = 0, physicsTotal = 0;
    const clearWindow = () => {
        lastAt = null; elapsedMs = 0; intervals = 0; samples = 0; renderTotal = 0; physicsTotal = 0;
        gpuTotal = 0; gpuSamples = 0; gpuBatch = null; gpuGeneration = gpuState().generation;
    };
    const publish = value => { snapshot = value; onUpdate({ ...snapshot }); };
    const reset = () => {
        if (disposed) return;
        gpuTimer?.reset(); clearWindow(); publish(emptySnapshot(gpuState().status));
    };
    const beginRender = () => {
        if (disposed || documentRef?.hidden) return;
        gpuBatch = gpuTimer?.poll() || null;
        gpuTimer?.begin();
    };
    const endRender = () => { if (!disposed) gpuTimer?.end(); };
    const record = ({ now, renderMs, physicsMs = 0, physicsRunning = false }) => {
        if (disposed || documentRef?.hidden || !Number.isFinite(now)) { gpuBatch = null; return; }
        const previousRunning = snapshot.physicsRunning, previousGpuStatus = snapshot.gpuStatus;
        const firstFrame = !snapshot.running, gpu = gpuState();
        // begin/end或驱动断裂发生后旧代次不能入窗口，GPU值立即清空而CPU/FPS保留。
        const gpuInvalidated = gpu.generation !== gpuGeneration;
        if (gpuInvalidated) { gpuTotal = 0; gpuSamples = 0; gpuGeneration = gpu.generation; }
        if (gpuBatch?.generation === gpuGeneration && gpu.status === 'supported') {
            for (const value of gpuBatch.samples) {
                if (!Number.isFinite(value) || value < 0) continue;
                gpuTotal += value; gpuSamples += 1;
            }
        }
        gpuBatch = null;
        if (lastAt !== null && now > lastAt) { elapsedMs += now - lastAt; intervals += 1; }
        lastAt = now;
        samples += 1;
        renderTotal += milliseconds(renderMs);
        physicsTotal += physicsRunning ? milliseconds(physicsMs) : 0;
        snapshot = { ...snapshot, running: true, physicsRunning, gpuStatus: gpu.status,
            gpuRenderMs: gpuInvalidated || gpu.status !== 'supported' ? null : snapshot.gpuRenderMs,
            physicsMs: physicsRunning ? milliseconds(physicsMs) : 0 };
        // 停止/恢复物理或GPU失效立即回显，数值和FPS仍按有限窗口刷新。
        if (elapsedMs < intervalMs || intervals === 0) {
            if (firstFrame || previousRunning !== physicsRunning || previousGpuStatus !== gpu.status || gpuInvalidated) onUpdate({ ...snapshot });
            return;
        }
        publish({ running: true, ready: true, fps: intervals * 1000 / elapsedMs,
            renderMs: renderTotal / samples, gpuStatus: gpu.status,
            gpuRenderMs: gpu.status === 'supported' && gpuSamples ? gpuTotal / gpuSamples : null,
            physicsMs: physicsRunning ? physicsTotal / samples : 0, physicsRunning });
        elapsedMs = 0; intervals = 0; samples = 0; renderTotal = 0; physicsTotal = 0; gpuTotal = 0; gpuSamples = 0;
    };
    const contextLost = () => { gpuTimer?.contextLost(); reset(); };
    const contextRestored = () => { gpuTimer?.restore(); reset(); };
    documentRef?.addEventListener?.('visibilitychange', reset);
    canvasRef?.addEventListener?.('webglcontextlost', contextLost);
    canvasRef?.addEventListener?.('webglcontextrestored', contextRestored);
    const dispose = () => {
        if (disposed) return;
        documentRef?.removeEventListener?.('visibilitychange', reset);
        canvasRef?.removeEventListener?.('webglcontextlost', contextLost);
        canvasRef?.removeEventListener?.('webglcontextrestored', contextRestored);
        reset(); gpuTimer?.dispose(); disposed = true;
    };
    return Object.freeze({ beginRender, endRender, record, reset, getState: () => ({ ...snapshot }), dispose });
}

export const createCanvasPerformance = (canvas, renderer) => createFramePerformance({
    gpuTimer: createGpuRenderTimer(renderer?.getContext?.()), canvasRef: canvas,
    onUpdate: detail => canvas.dispatchEvent(new CustomEvent('mmd-performance', { detail }))
});
