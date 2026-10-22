export const HMR_WEB_BASE = new URL('./vendor/hmr2/', import.meta.url).href;
const MODEL_ID = 'hmr2.0b-fp32-op18-dml-static';
const FIXED = { 'model.onnx': [2468364, '18ac7cbffe910bb3226f5033001b539aaf95b8457eff048a914811aafe2cc6b0'],
    'model.onnx.data': [2701262848, '8965dc3efed8456681816f590b51d0e93c7907e77606a22ffe53082070415065'] };
const BACKENDS = Object.freeze({
    webgpu: Object.freeze({ device: 'webgpu', entry: 'ort.webgpu.min.mjs', module: 'ort-wasm-simd-threaded.asyncify.mjs', wasm: 'ort-wasm-simd-threaded.asyncify.wasm', label: 'WebGPU' }),
    wasm: Object.freeze({ device: 'cpu', entry: 'ort.wasm.min.mjs', module: 'ort-wasm-simd-threaded.mjs', wasm: 'ort-wasm-simd-threaded.wasm', label: 'CPU/WASM' })
});
export function getHmrWebBackend(backend = 'webgpu') {
    if (!Object.hasOwn(BACKENDS, backend)) throw new Error('HMR网页后端无效');
    return BACKENDS[backend];
}
const runtimeFiles = backend => { const config = getHmrWebBackend(backend); return [config.entry, config.module, config.wasm, 'opencv.mjs']; };
const RUNTIME = [...new Set(Object.keys(BACKENDS).flatMap(runtimeFiles))];
const unavailable = reason => ({ available: false, reason });

export function validateHmrManifest(manifest, backend = 'webgpu') {
    const required = [...Object.keys(FIXED), ...runtimeFiles(backend)];
    if (!manifest || manifest.schemaVersion !== 1 || manifest.source !== 'hmr2-web') throw new Error('HMR资源清单格式无效');
    if (manifest.available !== true) throw new Error('模型未准备或校验未通过，请运行 npm run download:hmr2-model 后重新构建网页');
    const names = [...Object.keys(FIXED), ...RUNTIME];
    if (manifest.modelId !== MODEL_ID || manifest.runtimeVersion !== '1.26.0' || !Array.isArray(manifest.files)
        || new Set(manifest.files.map(f => f?.name)).size !== manifest.files.length
        || !required.every(name => manifest.files.some(f => f?.name === name))) throw new Error('HMR资源版本或文件集合不匹配，请重建网页以准备所选后端');
    for (const file of manifest.files) {
        if (!names.includes(file?.name) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('HMR资源元数据无效');
        const expected = FIXED[file.name];
        if (expected && (file.bytes !== expected[0] || file.sha256 !== expected[1])) throw new Error('HMR模型版本校验不匹配');
        if (!expected && file.bytes > 64 * 1024 * 1024) throw new Error('HMR运行时资源超限');
    }
    return manifest;
}

export async function hmrWebCapability(backend = 'webgpu', scope = globalThis) {
    getHmrWebBackend(backend);
    // CPU单线程运行不依赖WebGPU、SharedArrayBuffer或跨源隔离。
    if (backend === 'wasm') return typeof scope.WebAssembly?.instantiate === 'function' && typeof scope.Worker === 'function';
    if (!scope.isSecureContext || !scope.navigator?.gpu) return false;
    return Boolean(await scope.navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }));
}

// 清单限定16KiB；探测大文件只发HEAD，不为了显示选项而获取整个模型。
export async function probeHmrWebAssets({ baseUrl = HMR_WEB_BASE, fetchImpl = globalThis.fetch,
    capability = hmrWebCapability, signal, backend = 'webgpu' } = {}) {
    try {
        const needed = [...Object.keys(FIXED), ...runtimeFiles(backend)];
        const response = await fetchImpl(new URL('models.json', baseUrl), { cache: 'no-store', signal });
        if (!response.ok || !response.body?.getReader) return unavailable('模型未准备，请运行 npm run download:hmr2-model 后重新构建网页');
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
            while (true) {
                const { done, value } = await reader.read(); if (done) break;
                size += value.byteLength; if (size > 16384) throw new Error('HMR资源清单超限'); chunks.push(value);
            }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const manifest = validateHmrManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), backend);
        for (const file of manifest.files.filter(file => needed.includes(file.name))) {
            const head = await fetchImpl(new URL(file.name, baseUrl), { method: 'HEAD', cache: 'no-store', signal });
            if (!head.ok) return unavailable('HMR模型或运行资源缺失，请重新构建网页');
            const length = head.headers.get('content-length'), encoding = head.headers.get('content-encoding');
            if ((!encoding || encoding === 'identity') && length !== null && Number(length) !== file.bytes) return unavailable('HMR模型或运行资源大小不符');
        }
        if (!await capability(backend)) return unavailable(backend === 'wasm' ? 'HMR网页CPU模式需要浏览器支持WebAssembly和Worker' : 'HMR网页模式需要支持WebGPU的浏览器，并通过HTTPS或localhost打开');
        return { available: true, reason: '', manifest };
    } catch (error) {
        if (signal?.aborted) throw new DOMException('HMR资源检查已取消', 'AbortError');
        return unavailable(error.message || 'HMR资源检查失败');
    }
}

const defaultHash = async () => {
    const { RawSha256 } = await import('./hmr2-vendor/RawSha256.mjs'); return new RawSha256();
};
// 权重只分配一份目标buffer，逐块验长度与SHA；禁止response.arrayBuffer或保留所有chunk再拼接。
export async function readHmrAsset(url, file, { fetchImpl = globalThis.fetch, signal, progress = () => {}, hashFactory = defaultHash } = {}) {
    const response = await fetchImpl(url, { signal });
    if (!response.ok || !response.body?.getReader) throw new Error('HMR资源读取失败：' + file.name);
    const reader = response.body.getReader();
    try {
        const length = response.headers.get('content-length'), encoding = response.headers.get('content-encoding');
        if ((!encoding || encoding === 'identity') && length !== null && Number(length) !== file.bytes) throw new Error('HMR资源长度不匹配：' + file.name);
        let buffer;
        try { buffer = new ArrayBuffer(file.bytes); }
        catch (error) {
            if (!(error instanceof RangeError)) throw error;
            const pages = Math.ceil(file.bytes / 65536); buffer = new WebAssembly.Memory({ initial: pages, maximum: pages }).buffer;
        }
        const data = new Uint8Array(buffer, 0, file.bytes), hash = await hashFactory(); let offset = 0, last = 0;
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            if (signal?.aborted) throw new DOMException('HMR资源读取取消', 'AbortError');
            if (offset + value.byteLength > file.bytes) throw new Error('HMR资源超过大小预算：' + file.name);
            data.set(value, offset); hash.update(value); offset += value.byteLength;
            if (Date.now() - last > 500 || offset === file.bytes) { progress(offset, file.bytes); last = Date.now(); }
        }
        if (offset !== file.bytes) throw new Error('HMR资源被截断：' + file.name);
        const actual = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== file.sha256) throw new Error('HMR资源SHA-256不匹配：' + file.name);
        return data;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
