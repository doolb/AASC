// 统一编译入口；AbortSignal终止Worker，停止后不产生迟到的模型写入。
export async function compileHumanMpl(value, morphs, signal) {
    const source = String(value || '').trim().replace(/^\u0060{3}(?:mpl)?[ \t]*\r?\n([\s\S]*?)\r?\n\u0060{3}$/iu, '$1').trim();
    if (!source || new TextEncoder().encode(source).length > 65536) throw new Error('MPL需要1–64KiB代码');
    if (signal?.aborted) throw new Error('MPL请求已取消');
    return new Promise((resolve, reject) => {
        let worker, timer, settled = false;
        const cancel = () => finish(new Error('MPL请求已取消'));
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer); worker?.terminate(); signal?.removeEventListener('abort', cancel);
            if (error) reject(error); else resolve({ ...result, source });
        };
        try {
            worker = new Worker(new URL('./mmd-mpl-worker.mjs', import.meta.url), { type: 'module' });
            signal?.addEventListener('abort', cancel, { once: true });
            timer = setTimeout(() => finish(new Error('MPL编译超过30秒，已取消')), 30000);
            worker.onmessage = ({ data }) => {
                if (data?.error) return finish(new Error(data.error));
                if (!(data?.buffer instanceof ArrayBuffer) || !Number.isFinite(data.duration)
                    || !Array.isArray(data.bones) || !Array.isArray(data.morphs)) return finish(new Error('MPL结果无效'));
                finish(null, data);
            };
            worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'MPL Worker加载失败')); };
            worker.onmessageerror = () => finish(new Error('MPL结果传输失败'));
            worker.postMessage({ source, morphs });
        } catch (error) { finish(error); }
    });
}
