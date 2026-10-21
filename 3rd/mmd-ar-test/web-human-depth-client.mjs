import { DEPTH_SOURCE, depthInputDimensions, decodeDepthOutput } from './web-human-depth-core.mjs';

export function createDepthClient({
    workerFactory = () => new Worker(new URL('./web-human-depth-worker.mjs', import.meta.url), { type: 'module' }),
    timeoutMs = 180000
} = {}) {
    if (typeof workerFactory !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600000) throw new Error('深度客户端配置无效');
    let worker = null, pending = null, serial = 0, disposed = false;
    const abort = () => new DOMException('深度识别已取消', 'AbortError');
    function terminateWorker() {
        const oldWorker = worker; worker = null;
        // WASM同步计算不承诺协作式中断；终止专用Worker才能立即释放该线程及其整个ORT/WASM内存。
        // 移除回调并保留身份检查，防止浏览器已排队的旧消息/旧error影响后来创建的Worker。
        if (!oldWorker) return;
        oldWorker.onmessage = null; oldWorker.onerror = null; oldWorker.onmessageerror = null;
        oldWorker.terminate();
    }
    function cancel(error = abort()) {
        const task = pending; pending = null; serial++;
        if (task) { clearTimeout(task.timer); task.reject(error); }
        terminateWorker();
    }
    function initializeWorker() {
        const activeWorker = workerFactory();
        if (!activeWorker || typeof activeWorker.postMessage !== 'function' || typeof activeWorker.terminate !== 'function') throw new Error('深度Worker不可用');
        worker = activeWorker;
        activeWorker.onmessage = ({ data }) => {
            if (worker !== activeWorker || !pending || !data || data.id !== pending.id) return;
            if (data.type === 'progress') {
                // 进度UI异常不得打断模型任务或使Promise永不结束。
                try { pending.onProgress(data.message); } catch (error) { /* 调用者的显示错误不改变推理结果。 */ }
                return;
            }
            if (data.type !== 'result' && data.type !== 'error') return;
            const task = pending; pending = null; clearTimeout(task.timer);
            try {
                if (data.type === 'error') throw new Error(data.message || '整图相对深度识别失败');
                const result = data.result;
                if (!result || result.source !== DEPTH_SOURCE || result.inputWidth !== task.width || result.inputHeight !== task.height) throw new Error('深度Worker结果与当前任务不匹配');
                // 再核验跨线程数据契约；独立浮点副本不会受发送者释放或调用者原图影响。
                task.resolve(decodeDepthOutput(result.data, [1, result.height, result.width], result));
            } catch (error) { terminateWorker(); task.reject(error); }
        };
        const failed = event => {
            if (worker !== activeWorker) return;
            cancel(new Error(event?.message || '深度Worker加载或传输失败，请重新构建网页后重试'));
        };
        activeWorker.onerror = failed; activeWorker.onmessageerror = failed;
    }
    async function infer(image, onProgress = () => {}) {
        if (disposed) throw new Error('深度识别器已关闭');
        // 新调用使旧任务失效，即使新图无效也不能让旧图迟到成为当前结果。
        if (pending) cancel();
        const { width, height } = depthInputDimensions(image);
        if (typeof onProgress !== 'function') throw new Error('深度进度回调无效');
        let requestId = null;
        try {
            if (!worker) initializeWorker();
            const id = ++serial; requestId = id;
            return await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    if (pending?.id === id) cancel(new DOMException('深度识别超时，请重试', 'TimeoutError'));
                }, timeoutMs);
                pending = { id, resolve, reject, timer, onProgress, width, height };
                try {
                    // 只转移专用8位RGBA副本，不接图URL、不裁切、不损坏父UI继续显示的ImageData。
                    const data = new Uint8ClampedArray(image.data);
                    worker.postMessage({ type: 'infer', id, image: { width: image.width, height: image.height, data } }, [data.buffer]);
                } catch (error) { cancel(error); }
            });
        } catch (error) {
            if (pending && pending.id === requestId) cancel(error);
            throw error;
        }
    }
    return { infer, cancel, dispose() { disposed = true; cancel(); } };
}
// 同一工厂的兼容别名，调用者不必为整图深度另造图片URL或共享姿态Worker。
export const createImageDepthClient = createDepthClient;
