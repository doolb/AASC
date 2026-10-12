/*
 * 两端共用的帧统计：只采样现有绘制/物理调用，不另开渲染循环。
 * FPS使用实际帧间隔，CPU提交耗时不代表异步GPU执行时间。
 */
const physicsTimings = new WeakMap();
const emptySnapshot = () => ({ running: false, ready: false, fps: null, renderMs: null,
    physicsMs: 0, physicsRunning: false });
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
    intervalMs = 500 } = {}) {
    let snapshot = emptySnapshot();
    let lastAt = null, elapsedMs = 0, intervals = 0, samples = 0, renderTotal = 0, physicsTotal = 0;
    const clearWindow = () => { lastAt = null; elapsedMs = 0; intervals = 0; samples = 0; renderTotal = 0; physicsTotal = 0; };
    const publish = value => { snapshot = value; onUpdate({ ...snapshot }); };
    const reset = () => { clearWindow(); publish(emptySnapshot()); };
    const record = ({ now, renderMs, physicsMs = 0, physicsRunning = false }) => {
        if (documentRef?.hidden || !Number.isFinite(now)) return;
        const previousRunning = snapshot.physicsRunning;
        const firstFrame = !snapshot.running;
        if (lastAt !== null && now > lastAt) { elapsedMs += now - lastAt; intervals += 1; }
        lastAt = now;
        samples += 1;
        renderTotal += milliseconds(renderMs);
        physicsTotal += physicsRunning ? milliseconds(physicsMs) : 0;
        snapshot = { ...snapshot, running: true, physicsRunning,
            physicsMs: physicsRunning ? milliseconds(physicsMs) : 0 };
        // 停止/恢复物理立即清理旧状态，数值和FPS仍按有限窗口刷新。
        if (elapsedMs < intervalMs || intervals === 0) {
            if (firstFrame || previousRunning !== physicsRunning) onUpdate({ ...snapshot });
            return;
        }
        publish({ running: true, ready: true, fps: intervals * 1000 / elapsedMs,
            renderMs: renderTotal / samples, physicsMs: physicsRunning ? physicsTotal / samples : 0, physicsRunning });
        elapsedMs = 0; intervals = 0; samples = 0; renderTotal = 0; physicsTotal = 0;
    };
    documentRef?.addEventListener?.('visibilitychange', reset);
    return Object.freeze({ record, reset, getState: () => ({ ...snapshot }),
        dispose: () => { documentRef?.removeEventListener?.('visibilitychange', reset); reset(); } });
}

export const createCanvasPerformance = canvas => createFramePerformance({
    onUpdate: detail => canvas.dispatchEvent(new CustomEvent('mmd-performance', { detail }))
});
