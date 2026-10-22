import { HMR2_BODY25_NAMES, HMR2_BODY25_EDGES } from './web-human-pose-semantic.mjs';

export const HMR_INPUT_SHAPES = Object.freeze({ img: [1, 3, 256, 192], box_center: [1, 2], box_size: [1], img_size: [1, 2] });
export const HMR_OUTPUT_SHAPES = Object.freeze({ xyz: [1, 25, 3], xy: [1, 25, 2], rotations24: [1, 24, 3, 3],
    betas10: [1, 10], predCam: [1, 3], cameraTranslation: [1, 3], cameraDepth: [1, 25], focalLengthPx: [1], principalPointPx: [1, 2] });
const requireValue = (valid, message) => { if (!valid) throw new Error(message); };
const F = Math.fround, MEAN = [.485, .456, .406].map(v => v * 255), STD = [.229, .224, .225].map(v => v * 255);

export function validateHmrImage(image) {
    const { width, height, data } = image || {};
    requireValue(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
        && width <= 1600 && height <= 1600 && ArrayBuffer.isView(data) && data.BYTES_PER_ELEMENT === 1
        && data.length === width * height * 4, 'HMR图片须为完整RGBA，最长边不超过1600像素');
    return { width, height };
}
export function validateHmrBox(bbox, width, height) {
    const box = bbox === undefined ? [0, 0, width, height] : bbox;
    requireValue(Array.isArray(box) && box.length === 4 && Array.from(box).every(Number.isFinite)
        && box[0] >= 0 && box[1] >= 0 && box[2] <= width && box[3] <= height
        && box[2] > box[0] && box[3] > box[1], 'HMR人物框须为图片范围内非退化xyxy');
    return [...box];
}

// 与Node参考逐步float32舍入一致；不能将乘除合并，否则小数框会改变模型输入。
function geometry(box) {
    const [x0, y0, x1, y1] = box.map(F);
    const center = [F(F(x1 + x0) / 2), F(F(y1 + y0) / 2)];
    const width = F(F(F(x1 - x0) / 200) * 200), height = F(F(F(y1 - y0) / 200) * 200);
    const expanded = F(height / width) < F(256 / 192)
        ? [width, Math.max(F(F(width * 256) / 192), height)] : [Math.max(F(F(height * 192) / 256), width), height];
    const boxSize = Math.max(...expanded), factor = F(F(boxSize / 256) / 2), sigma = factor > F(1.1) ? F(F(factor - 1) / 2) : 0;
    const half = F(boxSize * .5), points = [center[0], center[1], center[0], F(center[1] + half), F(center[0] + half), center[1]];
    requireValue(width > 0 && height > 0 && [...points, boxSize, sigma].every(Number.isFinite), 'HMR人物框float32退化');
    return { center, boxSize, sigma, points };
}
function pairwise(values, start = 0, count = values.length) {
    if (count < 8) { let sum = -0; for (let i = 0; i < count; i++) sum += values[start + i]; return sum; }
    if (count > 128) { const half = Math.floor(Math.floor(count / 2) / 8) * 8; return pairwise(values, start, half) + pairwise(values, start + half, count - half); }
    const lanes = Array.from(values.slice(start, start + 8)); let i = 8;
    for (; i + 8 <= count; i += 8) for (let j = 0; j < 8; j++) lanes[j] += values[start + i + j];
    let total = ((lanes[0] + lanes[1]) + (lanes[2] + lanes[3])) + ((lanes[4] + lanes[5]) + (lanes[6] + lanes[7]));
    for (; i < count; i++) total += values[start + i]; return total;
}
// nearest边界和float64中间数据对应SciPy参考；只在专用Worker执行，不阻塞页面。
function blur(input, width, height, sigma) {
    const radius = Math.floor(4 * sigma + .5), coefficient = F(-.5 / F(sigma * sigma));
    const weights = Float64Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(coefficient * ((i - radius) ** 2)));
    const total = pairwise(weights); for (let i = 0; i < weights.length; i++) weights[i] /= total;
    let data = Float64Array.from(input);
    for (const axis of [0, 1]) {
        const output = new Float64Array(data.length);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
            const at = (y * width + x) * 3 + c;
            let sum = data[at] * weights[radius];
            for (let offset = -radius; offset < 0; offset++) {
                const ay = axis === 0 ? Math.max(0, y + offset) : y, by = axis === 0 ? Math.min(height - 1, y - offset) : y;
                const ax = axis === 1 ? Math.max(0, x + offset) : x, bx = axis === 1 ? Math.min(width - 1, x - offset) : x;
                sum += (data[(ay * width + ax) * 3 + c] + data[(by * width + bx) * 3 + c]) * weights[radius + offset];
            }
            output[at] = sum;
        }
        data = output;
    }
    return data;
}

export async function prepareHmrWebInput(image, bbox, cv) {
    const { width, height } = validateHmrImage(image), box = validateHmrBox(bbox, width, height), boxInfo = geometry(box);
    requireValue(typeof cv?.warpAffine === 'function' && typeof cv.CV_64FC3 === 'number', 'HMR OpenCV尚未就绪');
    const bgr = new Uint8Array(width * height * 3);
    for (let p = 0; p < width * height; p++) for (let c = 0; c < 3; c++) bgr[p * 3 + c] = image.data[p * 4 + 2 - c];
    const filtered = boxInfo.sigma > 0 ? blur(bgr, width, height, boxInfo.sigma) : bgr;
    const mats = [];
    try {
        const source = new cv.Mat(height, width, boxInfo.sigma > 0 ? cv.CV_64FC3 : cv.CV_8UC3); mats.push(source);
        (boxInfo.sigma > 0 ? source.data64F : source.data).set(filtered);
        const from = cv.matFromArray(3, 1, cv.CV_32FC2, boxInfo.points); mats.push(from);
        const to = cv.matFromArray(3, 1, cv.CV_32FC2, [128, 128, 128, 256, 256, 128]); mats.push(to);
        const matrix = cv.getAffineTransform(from, to); mats.push(matrix);
        const destination = new cv.Mat(); mats.push(destination);
        cv.warpAffine(source, destination, matrix, new cv.Size(256, 256), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
        const crop = boxInfo.sigma > 0 ? destination.data64F : destination.data, img = new Float32Array(3 * 256 * 192);
        for (let c = 0; c < 3; c++) for (let y = 0; y < 256; y++) for (let x = 0; x < 192; x++) {
            img[(c * 256 + y) * 192 + x] = F((F(crop[(y * 256 + x + 32) * 3 + 2 - c]) - MEAN[c]) / STD[c]);
        }
        return { inputs: { img, box_center: Float32Array.from(boxInfo.center), box_size: Float32Array.of(boxInfo.boxSize), img_size: Float32Array.of(width, height) },
            metadata: { imageSize: [width, height], boxXYXY: box, bboxSource: bbox === undefined ? 'full_image_fallback' : 'supplied' } };
    } finally { for (const mat of mats.reverse()) mat.delete(); }
}

export function decodeHmrWebOutputs(outputs, metadata, backend = 'webgpu') {
    requireValue(['webgpu', 'wasm'].includes(backend), 'HMR网页后端无效');
    const values = {};
    requireValue(outputs && Object.keys(outputs).length === Object.keys(HMR_OUTPUT_SHAPES).length, 'HMR九输出数量无效');
    for (const [name, shape] of Object.entries(HMR_OUTPUT_SHAPES)) {
        const tensor = outputs[name], count = shape.reduce((a, b) => a * b, 1);
        requireValue(tensor?.type === 'float32' && Array.isArray(tensor.dims) && tensor.dims.length === shape.length
            && shape.every((n, i) => tensor.dims[i] === n) && tensor.data instanceof Float32Array
            && tensor.data.length === count && tensor.data.every(Number.isFinite), 'HMR输出无效：' + name);
        values[name] = Array.from(tensor.data);
    }
    requireValue(values.cameraDepth.every(v => v > 0) && values.cameraTranslation[2] > 0, 'HMR输出深度无效');
    requireValue(values.focalLengthPx[0] > 0 && values.principalPointPx.every((v, i) => v === metadata.imageSize[i] / 2), 'HMR输出主点/焦距无效');
    const rows = (data, count, stride) => Array.from({ length: count }, (_, i) => data.slice(i * stride, (i + 1) * stride));
    return { type: 'hmr2.result', schemaVersion: 1, model: 'HMR2.0b', source: 'hmr2-web', precision: 'fp32', device: backend === 'wasm' ? 'cpu' : 'webgpu',
        ...metadata, names: [...HMR2_BODY25_NAMES], edges: HMR2_BODY25_EDGES.map(edge => [...edge]),
        xyz: rows(values.xyz, 25, 3), xy: rows(values.xy, 25, 2), rotations24: rows(values.rotations24, 24, 9).map(row => rows(row, 3, 3)),
        betas10: values.betas10, predCam: values.predCam, cameraDepth: values.cameraDepth, cameraTranslation: values.cameraTranslation,
        projection: { focalLengthPx: values.focalLengthPx[0], principalPointPx: values.principalPointPx },
        camera: { translation: values.cameraTranslation, focalLengthPx: values.focalLengthPx[0], principalPoint: values.principalPointPx } };
}
