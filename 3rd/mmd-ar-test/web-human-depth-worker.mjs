import { DEPTH_SOURCE, DEPTH_REVISION, DEPTH_REPOSITORY, DEPTH_FILES, depthInputDimensions,
    prepareDepthInput, decodeDepthOutput, validateDepthConfig } from './web-human-depth-core.mjs';

export const DEPTH_RESOURCE_PATHS = Object.freeze({
    ort: './vendor/pose/ort.wasm.min.mjs', wasm: './vendor/pose/', depth: './vendor/depth/'
});
const abortError = () => new DOMException('深度Worker已释放', 'AbortError');

// 注入点只用于独立自测；正式Worker固定从同部署js/vendor加载，不依赖tmp或用户图片URL。
export function createDepthWorkerRuntime({ scope = globalThis, fetchImpl = globalThis.fetch,
    importOrt = () => import(new URL(DEPTH_RESOURCE_PATHS.ort, import.meta.url).href),
    cryptoImpl = globalThis.crypto, now = () => performance.now() } = {}) {
    let resources = null, loading = null, activeTask = null, disposed = false, busy = false;
    const controller = new AbortController();
    const assetUrl = file => new URL(DEPTH_RESOURCE_PATHS.depth + file, import.meta.url).href;
    function post(message, transfer = []) {
        if (!disposed) scope.postMessage(message, transfer);
    }
    const progress = (id, message) => post({ type: 'progress', id, message });
    async function bytesFor(file) {
        const response = await fetchImpl(assetUrl(file.name) + '?sha256=' + file.sha256, { signal: controller.signal });
        if (!response.ok) throw new Error('深度资源读取失败：' + file.name + ' HTTP ' + response.status);
        const length = response.headers?.get('content-length'), encoding = response.headers?.get('content-encoding')?.trim().toLowerCase();
        // fetch交给调用者的是解压后body；gzip/br的Content-Length是传输字节，不能当模型字节数。
        if ((!encoding || encoding === 'identity') && length !== null && length !== undefined
            && (!/^\d+$/.test(length) || Number(length) !== file.size)) throw new Error('深度资源大小不匹配：' + file.name);
        // 对流和无流两种响应都检查固定字节预算；不接受服务端任意长度的数据后再创建会话。
        let bytes;
        if (response.body?.getReader) {
            const reader = response.body.getReader(), chunks = [];
            let size = 0;
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > file.size) throw new Error('深度资源超过固定大小预算：' + file.name);
                    chunks.push(value);
                }
            } catch (error) { await reader.cancel().catch(() => {}); throw error; }
            finally { reader.releaseLock(); }
            if (size !== file.size) throw new Error('深度资源不完整：' + file.name);
            bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        } else {
            bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.byteLength !== file.size) throw new Error('深度资源不完整：' + file.name);
        }
        // 安全上下文额外核对下载字节SHA；LAN HTTP没有SubtleCrypto时依靠构建阶段的完整SHA校验、
        // 固定清单及此处大小检查，不把不可用的浏览器加密API当作手机必须开启HTTPS的隐式门槛。
        if (cryptoImpl?.subtle) {
            const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
            const hash = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
            if (hash !== file.sha256) throw new Error('深度资源SHA-256不匹配：' + file.name);
        }
        if (disposed) throw abortError();
        return bytes;
    }
    function checkManifest(manifest) {
        const matches = (actual, expected) => actual?.name === expected.name && actual.size === expected.size && actual.sha256 === expected.sha256;
        if (!manifest || manifest.source !== DEPTH_SOURCE || manifest.repository !== DEPTH_REPOSITORY
            || manifest.revision !== DEPTH_REVISION || manifest.license !== 'Apache-2.0' || typeof manifest.runtime !== 'string'
            || !Array.isArray(manifest.models) || manifest.models.length !== 1 || !matches(manifest.models[0], DEPTH_FILES[0])
            || !Array.isArray(manifest.files) || manifest.files.length !== DEPTH_FILES.length
            || manifest.files.some((file, index) => !matches(file, DEPTH_FILES[index]))) throw new Error('深度资源清单与固定模型不匹配，请重新构建网页');
    }
    async function initialize(id) {
        if (resources) return resources;
        if (!loading) loading = (async () => {
            progress(id, '读取整图相对深度资源…');
            const response = await fetchImpl(assetUrl('models.json') + '?revision=' + DEPTH_REVISION, { signal: controller.signal });
            if (!response.ok) throw new Error('缺少深度模型清单，请重新构建网页');
            const manifest = await response.json(); checkManifest(manifest);
            const configBytes = await bytesFor(DEPTH_FILES[1]);
            const config = validateDepthConfig(JSON.parse(new TextDecoder().decode(configBytes)));
            const modelBytes = await bytesFor(DEPTH_FILES[0]);
            const ort = await importOrt();
            if (disposed) throw abortError();
            if (ort.env?.versions?.web && ort.env.versions.web !== manifest.runtime) throw new Error('深度与姿态ORT版本不匹配，请重新构建网页');
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.proxy = false;
            ort.env.wasm.wasmPaths = new URL(DEPTH_RESOURCE_PATHS.wasm, import.meta.url).href;
            progress(id, '初始化Depth Anything V2 Small · WASM单线程…');
            const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
            if (disposed) { await session.release(); throw abortError(); }
            if (session.inputNames?.length !== 1 || !session.outputNames?.length) { await session.release(); throw new Error('深度会话输入输出契约不匹配'); }
            resources = { ort, session, config }; return resources;
        })();
        try { return await loading; }
        catch (error) { loading = null; throw error; }
    }
    async function releaseSession() {
        const old = resources; resources = null; loading = null;
        if (old) await old.session.release();
    }
    function disposeTensor(tensor) {
        try { tensor?.dispose(); } catch (error) { /* 独立释放其它张量，不因单个dispose异常跳过余下清理。 */ }
    }
    async function infer(id, image) {
        let input = null, outputs = null, failed = false;
        try {
            // 先检查源图及minimal预算，失败不能下载/初始化模型，也不能在Worker分配超宽张量。
            depthInputDimensions(image);
            const { ort, session, config } = await initialize(id);
            if (disposed) throw abortError();
            progress(id, '计算当前整图相对深度…');
            const prepared = prepareDepthInput(image, config);
            input = new ort.Tensor('float32', prepared.data, [1, 3, prepared.height, prepared.width]);
            const started = now();
            outputs = await session.run({ [session.inputNames[0]]: input });
            if (disposed) throw abortError();
            const output = outputs[session.outputNames[0]];
            if (!output) throw new Error('深度模型缺少输出');
            const result = decodeDepthOutput(output.data, output.dims, {
                inputWidth: prepared.width, inputHeight: prepared.height, inferenceMs: now() - started
            });
            post({ type: 'result', id, result }, [result.data.buffer]);
        } catch (error) {
            failed = true;
            if (!disposed) post({ type: 'error', id, message: error.message || String(error) });
        } finally {
            disposeTensor(input);
            if (outputs) for (const output of Object.values(outputs)) disposeTensor(output);
            // 成功会话按Worker重用；推理/数据错误时释放坏会话，下次识别重新初始化。
            if (failed && !disposed) await releaseSession();
        }
    }
    async function dispose() {
        if (disposed) return;
        disposed = true; controller.abort();
        try { if (activeTask) await activeTask; }
        finally { await releaseSession(); }
    }
    async function handleMessage({ data }) {
        if (data?.type === 'dispose') { await dispose(); return; }
        if (disposed) return;
        const { id, image } = data || {};
        if (data?.type !== 'infer' || !Number.isSafeInteger(id) || id < 1) { post({ type: 'error', id, message: '深度Worker请求无效' }); return; }
        if (busy) { post({ type: 'error', id, message: '深度Worker已有任务，请取消后重试' }); return; }
        busy = true;
        const task = infer(id, image); activeTask = task;
        try { await task; }
        finally { if (activeTask === task) activeTask = null; busy = false; }
    }
    return { handleMessage, dispose };
}

// Node纯函数自测导入本模块时不启动Worker；浏览器仅在专用模块Worker上下文安装接收器。
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
    const runtime = createDepthWorkerRuntime({ scope: globalThis });
    globalThis.onmessage = async event => {
        try { await runtime.handleMessage(event); }
        catch (error) { globalThis.postMessage({ type: 'error', id: event.data?.id, message: error.message || String(error) }); }
    };
}
