import { POSE_BODY_KEYS, POSE_LIMB_SEGMENTS } from './web-human-pose-semantic.mjs';
// 整图相对深度的纯函数：不加载模型、不读取图片URL，也不自动改变骨骼或相机。
// Small 模型与 ONNX 导出为 Apache-2.0；固定来源、摘要和部署许可见深度资产清单。
export const DEPTH_SOURCE = 'depth-anything-v2-small';
export const DEPTH_DEGENERATE_RANGE = 1e-5;
export const DEPTH_REVISION = 'c70d1ddbcd93c9bda8098268cc3554adf5e8dd4f';
export const DEPTH_REPOSITORY = 'onnx-community/depth-anything-v2-small';
export const DEPTH_FILES = Object.freeze([
    Object.freeze({ name: 'model_quantized.onnx', remote: 'onnx/model_quantized.onnx', size: 27258801, sha256: 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d' }),
    Object.freeze({ name: 'preprocessor_config.json', remote: 'preprocessor_config.json', size: 461, sha256: '03576db3c13dd0471fdf5f5e1428befcb95de063fe699879150b293dc9e0a2c6' }),
    Object.freeze({ name: 'config.json', remote: 'config.json', size: 38, sha256: '3aee5b9bc4f711ee885c2526d871f0c8c6c8c4b26b8e04253d0167f6a83264f5' }),
    Object.freeze({ name: 'README.md', remote: 'README.md', size: 1739, sha256: '5c03bcb41e047e7760916b47889de3a8273c6a925cb3c16e5dbdeefac25167cb' })
]);
export const DEPTH_LIMITS = Object.freeze({ imageLongest: 1600, inputLongest: 1024, inputPixels: 518 * 1024 });
export const DEPTH_CONFIG = Object.freeze({
    do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, ensure_multiple_of: 14,
    image_mean: Object.freeze([0.485, 0.456, 0.406]), image_std: Object.freeze([0.229, 0.224, 0.225]),
    image_processor_type: 'DPTImageProcessor', keep_aspect_ratio: true, resample: 3,
    rescale_factor: 1 / 255, size: Object.freeze({ height: 518, width: 518 }), size_divisor: null
});
export const DEPTH_SEGMENTS = POSE_LIMB_SEGMENTS;
export const DEPTH_BODY_KEYS = POSE_BODY_KEYS;
const bodyKeys = new Set(DEPTH_BODY_KEYS);

export function validateDepthImage(image) {
    // 仅接受当前整图的8位RGBA像素，避免URL、Canvas对象、浮点NaN或无限解码尺寸进入Worker。
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
        || image.width < 1 || image.height < 1 || Math.max(image.width, image.height) > DEPTH_LIMITS.imageLongest
        || !(image.data instanceof Uint8ClampedArray || image.data instanceof Uint8Array)
        || image.data.length !== image.width * image.height * 4) throw new Error('深度图片像素无效，最长边须不超过1600');
}
export function validateDepthConfig(config) {
    const fields = ['do_normalize', 'do_pad', 'do_rescale', 'do_resize', 'ensure_multiple_of', 'image_processor_type',
        'keep_aspect_ratio', 'resample', 'rescale_factor', 'size_divisor'];
    if (!config || fields.some(key => config[key] !== DEPTH_CONFIG[key])
        || config.size?.width !== 518 || config.size?.height !== 518
        || ['image_mean', 'image_std'].some(key => !Array.isArray(config[key]) || config[key].length !== 3
            || config[key].some((value, index) => value !== DEPTH_CONFIG[key][index]))) throw new Error('深度预处理配置与固定模型不匹配');
    return config;
}
function validateInputSize(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || Math.max(width, height) > DEPTH_LIMITS.inputLongest || width * height > DEPTH_LIMITS.inputPixels) {
        throw new Error('深度模型输入超出安全预算，请使用较接近常规横竖比例的图片');
    }
}
export function depthInputDimensions(image, config = DEPTH_CONFIG) {
    validateDepthImage(image); validateDepthConfig(config);
    // 与DPT minimal规则一致：选缩放因子离1更近的轴，不裁切、不补边；相同距离时沿用高度轴。
    const sx = config.size.width / image.width, sy = config.size.height / image.height;
    const scale = Math.abs(1 - sx) < Math.abs(1 - sy) ? sx : sy;
    const width = Math.max(14, Math.round(image.width * scale / 14) * 14);
    const height = Math.max(14, Math.round(image.height * scale / 14) * 14);
    // 在分配RGB缓冲和创建ORT会话之前拒绝过宽输入，不能通过改为非minimal缩放掩盖预算问题。
    validateInputSize(width, height);
    return { width, height };
}
function cubic(value) {
    const x = Math.abs(value);
    if (x < 1) return (1.5 * x - 2.5) * x * x + 1;
    if (x < 2) return ((-0.5 * x + 2.5) * x - 4) * x + 2;
    return 0;
}
function resizeWeights(sourceSize, targetSize) {
    // 分离式双三次插值，缩小时扩大核做抗混叠；边界裁去核外样本后重新归一化。
    // 像素中心映射保持整图坐标一致，但不承诺与Pillow/不同浏览器Canvas逐位相同。
    const ratio = sourceSize / targetSize, filterScale = Math.max(1, ratio), radius = 2 * filterScale;
    return Array.from({ length: targetSize }, (_, index) => {
        const center = (index + 0.5) * ratio - 0.5;
        const start = Math.max(0, Math.ceil(center - radius)), end = Math.min(sourceSize - 1, Math.floor(center + radius));
        const weights = new Float64Array(end - start + 1);
        let sum = 0;
        for (let i = start; i <= end; i++) { const weight = cubic((i - center) / filterScale); weights[i - start] = weight; sum += weight; }
        for (let i = 0; i < weights.length; i++) weights[i] /= sum;
        return { start, weights };
    });
}
export function prepareDepthInput(image, config = DEPTH_CONFIG) {
    const { width, height } = depthInputDimensions(image, config);
    const wx = resizeWeights(image.width, width), wy = resizeWeights(image.height, height);
    const horizontal = new Float32Array(image.height * width * 3), data = new Float32Array(width * height * 3);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < width; x++) {
        const kernel = wx[x];
        for (let channel = 0; channel < 3; channel++) {
            let value = 0;
            for (let i = 0; i < kernel.weights.length; i++) value += image.data[(y * image.width + kernel.start + i) * 4 + channel] * kernel.weights[i];
            horizontal[(y * width + x) * 3 + channel] = value;
        }
    }
    const plane = width * height;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const kernel = wy[y];
        for (let channel = 0; channel < 3; channel++) {
            let value = 0;
            for (let i = 0; i < kernel.weights.length; i++) value += horizontal[((kernel.start + i) * width + x) * 3 + channel] * kernel.weights[i];
            const rgb = Math.round(Math.max(0, Math.min(255, value)));
            data[channel * plane + y * width + x] = (rgb * config.rescale_factor - config.image_mean[channel]) / config.image_std[channel];
        }
    }
    return { data, width, height };
}
function validateDepthValues(data, width, height) {
    validateInputSize(width, height);
    if (!(data instanceof Float32Array) || data.length !== width * height || !data.every(Number.isFinite)) throw new Error('深度输出浮点数据形状或有限性无效');
}
export function decodeDepthOutput(data, dims, metadata = {}) {
    if (!Array.isArray(dims) || dims.length !== 3 || dims[0] !== 1) throw new Error('深度输出必须为[1,H,W]');
    const height = dims[1], width = dims[2];
    validateDepthValues(data, width, height);
    const inputWidth = metadata.inputWidth ?? width, inputHeight = metadata.inputHeight ?? height;
    validateInputSize(inputWidth, inputHeight);
    if (inputWidth !== width || inputHeight !== height) throw new Error('深度输出尺寸与当前模型输入不匹配');
    const inferenceMs = metadata.inferenceMs ?? 0;
    if (!Number.isFinite(inferenceMs) || inferenceMs < 0) throw new Error('深度推理耗时无效');
    // 先拷贝原始浮点值，再另建排序副本；ORT输出可以立即dispose而不损坏返回数据。
    const values = new Float32Array(data), sorted = values.slice().sort();
    const low = sorted[Math.floor(sorted.length * 0.05)], high = sorted[Math.floor(sorted.length * 0.95)];
    return { width, height, data: values, low, high, inferenceMs, source: DEPTH_SOURCE, inputWidth, inputHeight };
}
function depthRange(depth) {
    if (!depth) throw new Error('缺少深度数据');
    validateDepthValues(depth.data, depth.width, depth.height);
    if (depth.source !== DEPTH_SOURCE || !Number.isFinite(depth.low) || !Number.isFinite(depth.high) || depth.high < depth.low) throw new Error('深度来源或归一化范围无效');
    const range = depth.high - depth.low;
    if (!Number.isFinite(range)) throw new Error('深度归一化范围无效');
    return range;
}
export function depthHeatmap(depth) {
    const range = depthRange(depth), pixels = new Uint8ClampedArray(depth.data.length * 4);
    const degenerate = range <= DEPTH_DEGENERATE_RANGE;
    for (let i = 0; i < depth.data.length; i++) {
        // 每图P5/P95仅用于显示，不修改原始浮点数据；退化图显示中性灰，不冒充远近信息。
        const value = degenerate ? 0 : Math.max(0, Math.min(1, (depth.data[i] - depth.low) / range));
        pixels.set(degenerate ? [128, 128, 128, 255] : [255 * value, 200 * value, 255 * (1 - value), 255], i * 4);
    }
    return pixels;
}
function samplePoint(depth, point, range) {
    if (!point || point.usable !== true || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return { valid: false, reason: '语义端点不可用' };
    const { width, height, data } = depth;
    const x = Math.round(point.x * (width - 1)), y = Math.round(point.y * (height - 1));
    if (point.x < 0.02 || point.x > 0.98 || point.y < 0.02 || point.y > 0.98
        || x < 2 || x + 2 >= width || y < 2 || y + 2 >= height) return { valid: false, reason: '端点位于整图边界或出画' };
    const values = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) values.push(data[(y + dy) * width + x + dx]);
    values.sort((a, b) => a - b);
    const spread = (values[22] - values[2]) / range;
    if (!Number.isFinite(spread) || spread >= 0.12) return { valid: false, reason: '5×5邻域表面深度不稳定' };
    return { valid: true, value: values[12] };
}
export function buildDepthHints(depth, points) {
    const range = depthRange(depth), hints = [], rejected = [];
    if (!Array.isArray(points)) throw new Error('深度线索需要整图归一化语义点数组');
    const indexed = new Map(), duplicates = new Set();
    for (const point of points) {
        if (!bodyKeys.has(point?.key)) continue;
        if (indexed.has(point.key)) duplicates.add(point.key);
        indexed.set(point.key, point);
    }
    const samples = new Map(DEPTH_BODY_KEYS.map(key => [key, range <= DEPTH_DEGENERATE_RANGE
        ? { valid: false, reason: '整图深度退化，不提供排序' }
        : duplicates.has(key) ? { valid: false, reason: '语义端点重复，归属不明确' } : samplePoint(depth, indexed.get(key), range)]));
    for (const [a, b] of DEPTH_SEGMENTS) {
        const pa = samples.get(a), pb = samples.get(b);
        const delta = pa.valid && pb.valid ? (pb.value - pa.value) / range : null;
        const valid = pa.valid && pb.valid && Number.isFinite(delta) && Math.abs(delta) >= 0.07;
        if (!valid) {
            rejected.push({ a, b, reason: !pa.valid ? pa.reason : !pb.valid ? pb.reason : '归一化前后差小于0.07', normalizedDifference: Number.isFinite(delta) ? delta : null });
            continue;
        }
        // DA数值越大越近；因此b-a沿相机正深度方向的符号为-Math.sign(delta)。
        // 只提供小权重顺序候选，不推断人体分割、遮挡归属、米制骨z或左右标签；采用开关由调用者控制。
        hints.push({ a, b, sign: -Math.sign(delta), weight: 0.25, normalizedDifference: delta, ownership: 'unverified-visible-surface' });
    }
    return { hints, rejected };
}
