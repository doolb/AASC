// 预后处理参考OpenCV Zoo MediaPipe Pose（Apache-2.0），固定模型与许可证见pose-onnx-NOTICES.md。
// 单人静态图片只选最高分人物，不依赖OpenCV JS，避免再引入整套图像运行时。
const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, value))));
export function detectorAnchors() {
    const anchors = [];
    for (const [size, repeats] of [[28, 2], [14, 2], [7, 6]]) {
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            for (let i = 0; i < repeats; i++) anchors.push([(x + 0.5) / size, (y + 0.5) / size]);
        }
    }
    return anchors;
}
const anchors = detectorAnchors();
function validateImage(image) {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1
        || image.width * image.height > 4096 * 4096 || image.data?.length !== image.width * image.height * 4) throw new Error('图片尺寸或像素无效');
}
// 双线性采样，与原图坐标保持一致；ROI之外按黑色补齐。
function rgb(image, x, y, channel) {
    if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return 0;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1);
    const a = x - x0, b = y - y0, at = (u, v) => image.data[(v * image.width + u) * 4 + channel];
    return (at(x0, y0) * (1 - a) + at(x1, y0) * a) * (1 - b) + (at(x0, y1) * (1 - a) + at(x1, y1) * a) * b;
}
export function prepareDetector(image) {
    validateImage(image);
    const ratio = 224 / Math.max(image.width, image.height);
    const resizedWidth = Math.floor(image.width * ratio), resizedHeight = Math.floor(image.height * ratio);
    const padX = Math.floor((224 - resizedWidth) / 2), padY = Math.floor((224 - resizedHeight) / 2);
    const tensor = new Float32Array(3 * 224 * 224);
    for (let y = padY; y < padY + resizedHeight; y++) for (let x = padX; x < padX + resizedWidth; x++) {
        const u = Math.max(0, Math.min(image.width - 1, (x - padX + 0.5) / ratio - 0.5));
        const v = Math.max(0, Math.min(image.height - 1, (y - padY + 0.5) / ratio - 0.5));
        for (let c = 0; c < 3; c++) tensor[c * 224 * 224 + y * 224 + x] = rgb(image, u, v, c) / 127.5 - 1;
    }
    return { tensor, ratio, padX, padY, width: image.width, height: image.height };
}
export function decodePerson(boxes, scores, input) {
    if (boxes.length !== 2254 * 12 || scores.length !== 2254) throw new Error('人物检测模型输出不匹配');
    let selected = -1, best = 0.5;
    for (let i = 0; i < scores.length; i++) {
        const score = sigmoid(scores[i]); if (score > best) { best = score; selected = i; }
    }
    if (selected < 0) return null;
    const base = selected * 12, anchor = anchors[selected];
    const point = offset => [(boxes[base + offset] + anchor[0] * 224 - input.padX) / input.ratio,
        (boxes[base + offset + 1] + anchor[1] * 224 - input.padY) / input.ratio];
    return { hip: point(4), full: point(6), score: best };
}
export function preparePose(image, person) {
    validateImage(image);
    const [cx, cy] = person.hip, dx = person.full[0] - cx, dy = person.full[1] - cy;
    const radius = Math.hypot(dx, dy), angle = Math.PI / 2 - Math.atan2(-dy, dx);
    if (![cx, cy, radius, angle].every(Number.isFinite) || radius < 2 || radius > Math.max(image.width, image.height) * 4) throw new Error('人物范围无效，请换一张全身图片');
    const cos = Math.cos(angle), sin = Math.sin(angle), tensor = new Float32Array(256 * 256 * 3);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const u = (x + 0.5 - 128) * radius / 128, v = (y + 0.5 - 128) * radius / 128;
        const sx = cx + cos * u - sin * v, sy = cy + sin * u + cos * v;
        for (let c = 0; c < 3; c++) tensor[(y * 256 + x) * 3 + c] = rgb(image, sx, sy, c) / 255;
    }
    return { tensor, cx, cy, radius, angle, cos, sin };
}
export function decodePose(points, world, confidence, roi, image) {
    if (points.length !== 195 || world.length !== 117 || !points.every(Number.isFinite) || !world.every(Number.isFinite)) throw new Error('姿态模型输出无效');
    if (!Number.isFinite(confidence) || confidence < 0.5) throw new Error('未识别到可靠姿态，请使用清晰的全身图片');
    const landmarks = [];
    for (let i = 0; i < 33; i++) {
        const u = (points[i * 5] - 128) * roi.radius / 128, v = (points[i * 5 + 1] - 128) * roi.radius / 128;
        const x = world[i * 3], y = world[i * 3 + 1];
        landmarks.push({ x: (roi.cx + roi.cos * u - roi.sin * v) / image.width,
            y: (roi.cy + roi.sin * u + roi.cos * v) / image.height,
            world: [roi.cos * x - roi.sin * y, roi.sin * x + roi.cos * y, world[i * 3 + 2]],
            visibility: sigmoid(points[i * 5 + 3]), presence: sigmoid(points[i * 5 + 4]) });
    }
    return { landmarks, confidence };
}
