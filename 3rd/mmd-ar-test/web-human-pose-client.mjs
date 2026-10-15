export function createImagePoseClient({ workerFactory = () => new Worker(new URL('./web-human-pose-worker.mjs', import.meta.url), { type: 'module' }) } = {}) {
    let worker = null, pending = null, serial = 0, disposed = false;
    const abort = () => new DOMException('识别已取消', 'AbortError');
    function cancel() {
        const old = pending; pending = null; serial++;
        if (old) { clearTimeout(old.timer); old.reject(abort()); }
        worker?.terminate(); worker = null;
    }
    function infer(image, onProgress = () => {}) {
        if (disposed) return Promise.reject(new Error('姿态识别器已关闭'));
        if (pending) cancel();
        try {
            if (!worker) {
                worker = workerFactory();
                worker.onmessage = ({ data }) => {
                    if (!pending || data.id !== pending.id) return;
                    if (data.type === 'progress') { pending.onProgress(data.message); return; }
                    const task = pending; pending = null; clearTimeout(task.timer);
                    if (data.type === 'result') task.resolve(data.result);
                    else task.reject(new Error(data.message || '本地姿态识别失败'));
                };
                worker.onerror = event => {
                    const old = pending; pending = null;
                    if (old) { clearTimeout(old.timer); old.reject(new Error(event.message || '姿态Worker加载失败，请重新构建或重试')); }
                    worker?.terminate(); worker = null;
                };
            }
            const id = ++serial;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => cancel(), 180000);
                pending = { id, resolve, reject, timer, onProgress };
                // 保留调用者的预览数据；只转移专用副本，Worker取消也不会损坏原图。
                try {
                    const data = new Uint8ClampedArray(image.data);
                    worker.postMessage({ id, image: { width: image.width, height: image.height, data } }, [data.buffer]);
                } catch (error) {
                    clearTimeout(timer); pending = null; worker?.terminate(); worker = null; reject(error);
                }
            });
        } catch (error) { cancel(); return Promise.reject(error); }
    }
    return { infer, cancel, dispose() { disposed = true; cancel(); } };
}
