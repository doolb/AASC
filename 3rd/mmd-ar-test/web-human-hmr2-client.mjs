import { HMR2_BODY25_NAMES, HMR2_BODY25_EDGES, createHmr2SemanticPose } from './web-human-pose-semantic.mjs';

const MAX_PNG_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const DEFAULT_TIMEOUT_MS = 180_000;
const NATIVE_SOURCE = 'official 4D-Humans checkpoint; embedded SMPL buffers via smplx.lbs';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const TIMING_KEYS = ['preprocess', 'hostToDevice', 'network', 'lbs', 'projection', 'deviceToHost', 'total', 'modelLoad'];
const MEMORY_KEYS = ['allocatedMiB', 'reservedMiB', 'peakAllocatedMiB', 'peakReservedMiB', 'deviceFreeMiB', 'deviceTotalMiB'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegative = value => Number.isFinite(value) && value >= 0;

// 本地与HTTP错误使用同一稳定结构；不附加请求、token、图片或原始网络异常，避免敏感信息泄漏。
function clientError(code, message, status = 0, name = 'Hmr2ClientError') {
    const error = new Error(message);
    error.name = name;
    error.code = code;
    error.status = status;
    error.retryable = code === 'timeout' || code === 'network_error' || status === 429 || status === 503;
    return error;
}
const invalidResult = field => clientError('invalid_result', `HMR2返回无效结果：${field}`, 502);
const abortError = () => clientError('cancelled', 'HMR2请求已取消', 0, 'AbortError');

/** 服务根地址可含反向代理前缀；拒绝隐式协议、URL账户、查询串和片段，不猜测或改写API路由。 */
export function normalizeHmr2BaseUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) throw clientError('invalid_base_url', '请输入HTTP(S)服务根地址', 400);
    const text = value.trim();
    if (!text || /[\s\\?#\u0000-\u001f\u007f]/.test(text)) {
        throw clientError('invalid_base_url', '服务地址不能包含空白、反斜杠、查询串或片段', 400);
    }
    try {
        const url = new URL(text);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
            throw clientError('invalid_base_url', '仅允许不含账号密码的HTTP(S)服务地址', 400);
        }
        return url.href.replace(/\/+$/, '');
    } catch (error) {
        if (error.code === 'invalid_base_url') throw error;
        throw clientError('invalid_base_url', '请输入完整且有效的HTTP(S)服务根地址', 400);
    }
}

function normalizeToken(value = '') {
    if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f-\uffff]/.test(value)) {
        throw clientError('invalid_token', '会话token必须是可安全用于HTTP头的文本', 400);
    }
    const token = value.trim();
    if (token && !/^[\x21-\x7e]+$/.test(token)) throw clientError('invalid_token', '请仅填写token本身，不含Bearer前缀或空白', 400);
    return token;
}

function validateBbox(bbox, width, height) {
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
        throw clientError('invalid_bbox', '人物框必须是四个有限数值的像素xyxy', 400);
    }
    const [x1, y1, x2, y2] = bbox;
    if (!(0 <= x1 && x1 < x2 && x2 <= width && 0 <= y1 && y1 < y2 && y2 <= height)) {
        throw clientError('invalid_bbox', '人物框超出上传图片或面积为零；请使用像素xyxy而非xywh', 400);
    }
    return [...bbox];
}

function copyImage(image) {
    if (!Number.isSafeInteger(image?.width) || !Number.isSafeInteger(image?.height)
        || image.width < 1 || image.height < 1) throw clientError('invalid_image', '图片尺寸或RGBA像素无效', 400);
    const pixels = image.width * image.height;
    if (!Number.isSafeInteger(pixels) || pixels > MAX_PIXELS) throw clientError('image_too_large', '图片超过4000万像素，请先缩小', 413);
    const data = image.data;
    const byteView = ArrayBuffer.isView(data) && data.BYTES_PER_ELEMENT === 1;
    if ((!byteView && !Array.isArray(data)) || data.length !== pixels * 4
        || (Array.isArray(data) && !data.every(value => Number.isInteger(value) && value >= 0 && value <= 255))) {
        throw clientError('invalid_image', '图片必须提供完整RGBA字节像素', 400);
    }
    // 不转移或改写调用者的ImageData；异步编码期间换图/改像素也不会改变本次上传快照。
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(data) };
}

/** 默认在浏览器由现成画布编码PNG；encodeImage注入点也可用于无DOM协议测试。 */
async function encodePng(image) {
    let canvas;
    try {
        if (typeof globalThis.OffscreenCanvas === 'function') canvas = new OffscreenCanvas(image.width, image.height);
        else if (globalThis.document?.createElement) {
            canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        }
        if (!canvas || typeof globalThis.ImageData !== 'function') throw clientError('encoding_unavailable', '当前环境无法编码PNG图片');
        const context = canvas.getContext('2d');
        if (!context) throw clientError('encoding_unavailable', '无法创建PNG编码画布');
        context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        if (typeof canvas.convertToBlob === 'function') return await canvas.convertToBlob({ type: 'image/png' });
        return await new Promise((resolve, reject) => {
            canvas.toBlob(blob => blob ? resolve(blob) : reject(clientError('encode_failed', 'PNG编码失败')), 'image/png');
        });
    } finally {
        if (canvas) canvas.width = canvas.height = 0;
    }
}

function base64ToBytes(value) {
    const text = value.replace(/^data:image\/png;base64,/i, '');
    if (!text) throw clientError('encode_failed', 'PNG编码器返回了空图片');
    if (text.length > 4 * Math.ceil(MAX_PNG_BYTES / 3)) throw clientError('image_too_large', 'PNG图片超过16MiB限制', 413);
    if (text.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(text) || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
        throw clientError('encode_failed', 'PNG编码器返回了无效base64');
    }
    try {
        const binary = atob(text);
        return Uint8Array.from(binary, char => char.charCodeAt(0));
    } catch (error) {
        throw clientError('encode_failed', 'PNG编码器返回了无效base64');
    }
}

async function pngBytes(encoded, image, assertActive) {
    let bytes = encoded;
    if (typeof encoded === 'string') bytes = base64ToBytes(encoded);
    if (typeof globalThis.Blob === 'function' && encoded instanceof Blob) {
        if (encoded.size > MAX_PNG_BYTES) throw clientError('image_too_large', 'PNG图片超过16MiB限制', 413);
        if (encoded.type && encoded.type !== 'image/png') throw clientError('encode_failed', '只允许PNG编码，不上传原图文件');
        bytes = await encoded.arrayBuffer(); assertActive();
    }
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1) throw clientError('encode_failed', 'PNG编码器须返回Blob、字节数组或base64');
    if (bytes.byteLength > MAX_PNG_BYTES) throw clientError('image_too_large', 'PNG图片超过16MiB限制', 413);
    bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // 检查PNG签名及IHDR尺寸，确保注入编码器不能把EXIF原图/JPEG或另一张图冒充当前画布快照。
    if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)
        || ![0, 0, 0, 13, 73, 72, 68, 82].every((byte, i) => bytes[i + 8] === byte)) {
        throw clientError('encode_failed', '编码器未返回有效的PNG头');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(16) !== image.width || view.getUint32(20) !== image.height) {
        throw clientError('encode_failed', 'PNG尺寸与当前上传图片不一致');
    }
    return bytes;
}

function bytesToBase64(bytes) {
    const chunks = [];
    // 限定每次展开的字节数，避免16MiB图片导致调用栈溢出；base64一次编码，不对分块分别补padding。
    for (let offset = 0; offset < bytes.length; offset += 32768) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    }
    return btoa(chunks.join(''));
}

function requireShape(value, shape, field) {
    if (!shape.length) {
        if (!Number.isFinite(value)) throw invalidResult(field);
        return;
    }
    if (!Array.isArray(value) || value.length !== shape[0]) throw invalidResult(field);
    for (const item of value) requireShape(item, shape.slice(1), field);
}
function requireNumbers(value, keys, field) {
    if (!object(value) || !keys.every(key => nonnegative(value[key]))) throw invalidResult(field);
}
function validateHealth(health) {
    if (!object(health) || health.type !== 'hmr2.health' || typeof health.ready !== 'boolean'
        || health.model !== 'HMR2.0b' || health.precision !== 'fp32') {
        throw clientError('invalid_health', '服务健康响应不符合HMR2 GPU FP32协议', 502);
    }
    if ((health.device !== undefined && health.device !== null && !/^cuda:\d+$/.test(health.device))
        || (health.busy !== undefined && typeof health.busy !== 'boolean')) {
        throw clientError('invalid_health', '服务健康响应的GPU或忙闲状态无效', 502);
    }
    return health;
}

function validateResult(result, image, bbox) {
    if (!object(result) || result.type !== 'hmr2.result' || result.schemaVersion !== 1) throw invalidResult('type/schemaVersion');
    if (result.model !== 'HMR2.0b' || result.source !== NATIVE_SOURCE || result.precision !== 'fp32'
        || typeof result.device !== 'string' || !/^cuda:\d+$/.test(result.device)) throw invalidResult('model/source/device/precision');
    if (!object(result.gpu) || !Number.isInteger(result.gpu.index) || result.gpu.index < 0
        || result.device !== `cuda:${result.gpu.index}` || typeof result.gpu.name !== 'string' || !result.gpu.name.trim()) throw invalidResult('gpu');
    requireShape(result.imageSize, [2], 'imageSize');
    if (result.imageSize[0] !== image.width || result.imageSize[1] !== image.height) throw invalidResult('imageSize与上传图片不一致');
    if (!Array.isArray(result.names) || result.names.length !== 25
        || !HMR2_BODY25_NAMES.every((name, index) => result.names[index] === name)) throw invalidResult('BODY25 names/左右顺序');
    requireShape(result.edges, [HMR2_BODY25_EDGES.length, 2], 'edges');
    if (!HMR2_BODY25_EDGES.every((edge, i) => edge.every((index, j) => result.edges[i][j] === index))) throw invalidResult('BODY25 edges');
    // 实际wire名称是xyz/xy，分别25×3/25×2，不接受旧候选xyz25/landmarks33的替代字段。
    for (const [field, shape] of Object.entries({ xyz: [25, 3], xy: [25, 2], cameraDepth: [25],
        rotations24: [24, 3, 3], betas10: [10], predCam: [3], cameraTranslation: [3] })) requireShape(result[field], shape, field);
    if (!result.cameraDepth.every(value => value > 0) || result.cameraTranslation[2] <= 0) throw invalidResult('cameraDepth必须为正');
    if (!object(result.projection) || !Number.isFinite(result.projection.focalLengthPx) || result.projection.focalLengthPx <= 0) throw invalidResult('projection');
    requireShape(result.projection.principalPointPx, [2], 'principalPointPx');
    if (result.projection.principalPointPx[0] !== image.width / 2 || result.projection.principalPointPx[1] !== image.height / 2) throw invalidResult('projection主点');
    if (!object(result.camera)) throw invalidResult('camera');
    requireShape(result.camera.translation, [3], 'camera.translation');
    requireShape(result.camera.principalPoint, [2], 'camera.principalPoint');
    if (!result.camera.translation.every((value, i) => value === result.cameraTranslation[i])
        || result.camera.focalLengthPx !== result.projection.focalLengthPx
        || !result.camera.principalPoint.every((value, i) => value === result.projection.principalPointPx[i])) throw invalidResult('camera/projection不一致');
    let box;
    try { box = validateBbox(result.boxXYXY, image.width, image.height); }
    catch (error) { throw invalidResult('boxXYXY'); }
    const expectedBox = bbox || [0, 0, image.width, image.height];
    if (!box.every((value, i) => value === expectedBox[i]) || result.bboxSource !== (bbox ? 'supplied' : 'full_image_fallback')) throw invalidResult('人物框与请求不一致');
    if (!nonnegative(result.inferenceMs) || !nonnegative(result.modelLoadMs)
        || typeof result.inputTensorSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result.inputTensorSha256)) throw invalidResult('耗时/输入摘要');
    requireNumbers(result.timingMs, TIMING_KEYS, 'timingMs');
    requireNumbers(result.memory, MEMORY_KEYS, 'memory');
    return result;
}

function serverError(payload, status) {
    const detail = object(payload?.error) ? payload.error : {};
    const code = typeof detail.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(detail.code) ? detail.code : 'http_error';
    const message = typeof detail.message === 'string' && detail.message.trim()
        ? detail.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 2048) : `HMR2服务请求失败（HTTP ${status}）`;
    return clientError(code, message, status);
}

/**
 * 单飞HTTP客户端：新health/infer取消旧等待；取消不承诺中断服务器已开始的PyTorch计算。
 * encodeImage(image, {signal})可返回PNG Blob/ArrayBuffer/Uint8Array/裸base64或PNG data URI。
 * token仅属于本次请求，客户端不读写localStorage/sessionStorage，也不在错误或进度中回显。
 */
export function createHmr2PoseClient({ fetchImpl = globalThis.fetch?.bind(globalThis), encodeImage = encodePng, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (typeof fetchImpl !== 'function' || typeof encodeImage !== 'function'
        || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
        throw clientError('invalid_client_config', 'HMR2客户端需要fetch、PNG编码器和有效超时');
    }
    let pending = null;
    let disposed = false;
    function cancel() {
        if (!pending) return;
        const task = pending; pending = null; task.abort(abortError());
    }
    async function run(work) {
        if (disposed) throw clientError('disposed', 'HMR2客户端已关闭');
        cancel();
        const controller = new AbortController();
        const task = { controller, reason: null, timer: null, abort: null };
        const aborted = new Promise((resolve, reject) => {
            task.abort = error => {
                if (task.reason) return;
                task.reason = error; clearTimeout(task.timer); controller.abort(); reject(error);
            };
        });
        const assertActive = () => {
            if (task.reason) throw task.reason;
            if (disposed || pending !== task) throw abortError();
        };
        pending = task;
        task.timer = setTimeout(() => task.abort(clientError('timeout', 'HMR2请求超时，请检查服务状态后重试', 0, 'TimeoutError')), timeoutMs);
        try {
            // 即使注入fetch/编码器无视signal，race也会立刻结束等待；迟到工作在每个await后再次检查代次。
            return await Promise.race([work({ signal: controller.signal, assertActive }), aborted]);
        } catch (error) {
            if (task.reason) throw task.reason;
            if (error?.code && ['Hmr2ClientError', 'AbortError', 'TimeoutError'].includes(error.name)) throw error;
            if (error?.name === 'AbortError') throw abortError();
            throw clientError('network_error', 'HMR2请求失败，请检查网络、服务地址、CORS白名单及HTTPS混合内容');
        } finally {
            clearTimeout(task.timer);
            if (pending === task) pending = null;
        }
    }
    async function request(baseUrl, token, method, body, task) {
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        task.assertActive();
        const response = await fetchImpl(`${baseUrl}/${method === 'GET' ? 'health' : 'infer'}`, {
            method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: task.signal,
            credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        });
        task.assertActive();
        let payload;
        try { payload = await response.json(); }
        catch (error) {
            task.assertActive();
            if (!response.ok) throw serverError(null, response.status);
            throw clientError('invalid_json', 'HMR2服务未返回有效JSON', 502);
        }
        task.assertActive();
        if (!response.ok) throw serverError(payload, response.status);
        if (object(payload?.error)) {
            const status = Number.isInteger(payload.error.status) && payload.error.status >= 400 && payload.error.status <= 599 ? payload.error.status : 502;
            throw serverError(payload, status);
        }
        return payload;
    }
    async function testConnection({ baseUrl, token } = {}) {
        return await run(async task => {
            const url = normalizeHmr2BaseUrl(baseUrl), auth = normalizeToken(token);
            // 健康测试不调用PNG编码器，不携带任何请求体，也不触发推理。
            return validateHealth(await request(url, auth, 'GET', undefined, task));
        });
    }
    async function infer(image, { baseUrl, token, bbox } = {}, onProgress = () => {}) {
        return await run(async task => {
            const url = normalizeHmr2BaseUrl(baseUrl), auth = normalizeToken(token), snapshot = copyImage(image);
            const box = bbox === undefined ? undefined : validateBbox(bbox, snapshot.width, snapshot.height);
            const progress = message => {
                task.assertActive();
                if (typeof onProgress === 'function') onProgress(message);
                task.assertActive();
            };
            progress('正在将当前图片编码为PNG…');
            let bytes;
            try {
                const encoded = await encodeImage(snapshot, { signal: task.signal });
                task.assertActive();
                bytes = await pngBytes(encoded, snapshot, task.assertActive);
                task.assertActive();
            } catch (error) {
                task.assertActive();
                if (error?.code && ['Hmr2ClientError', 'AbortError', 'TimeoutError'].includes(error.name)) throw error;
                if (error?.name === 'AbortError') throw abortError();
                throw clientError('encode_failed', '无法将当前图片编码为PNG');
            }
            const payload = { image_base64: bytesToBase64(bytes), ...(box ? { bbox_xyxy: box } : {}) };
            progress('正在上传图片并等待HMR2 GPU推理…');
            const raw = validateResult(await request(url, auth, 'POST', payload, task), snapshot, box);
            task.assertActive();
            const pose = createHmr2SemanticPose(raw);
            progress('HMR2原生BODY25结果已校验');
            return { candidates: [pose], inferenceMs: raw.inferenceMs };
        });
    }
    return { testConnection, infer, cancel, dispose() { disposed = true; cancel(); } };
}
