// 预后处理参考OpenCV Zoo MediaPipe Pose（Apache-2.0），固定模型与许可证见pose-onnx-NOTICES.md。
// 静态图片保留有限数量的独立候选，不依赖OpenCV JS，避免再引入整套图像运行时。
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
function intersectionOverUnion(a, b) {
    const intersection = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
        * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    return intersection / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection);
}
export function decodePeople(boxes, scores, input) {
    if (boxes.length !== 2254 * 12 || scores.length !== 2254) throw new Error('人物检测模型输出不匹配');
    const candidates = [];
    for (let i = 0; i < scores.length; i++) {
        if (!Number.isFinite(scores[i])) continue;
        const score = sigmoid(scores[i]);
        if (score < 0.35) continue;
        const base = i * 12, anchor = anchors[i];
        const point = offset => [(boxes[base + offset] + anchor[0] * 224 - input.padX) / input.ratio,
            (boxes[base + offset + 1] + anchor[1] * 224 - input.padY) / input.ratio];
        const [cx, cy] = point(0), width = boxes[base + 2] / input.ratio, height = boxes[base + 3] / input.ratio;
        const hip = point(4), full = point(6), radius = Math.hypot(full[0] - hip[0], full[1] - hip[1]);
        if (![cx, cy, width, height, ...hip, ...full, radius].every(Number.isFinite)
            || width <= 0 || height <= 0 || radius < 2 || radius > Math.max(input.width, input.height) * 4) continue;
        candidates.push({ hip, full, score, box: [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2] });
    }
    // 模型检测框覆盖头部附近，不能当作整个人体框；去掉同一区域的重复锚点后再限定手机推理预算。
    const selected = [];
    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
        if (selected.some(person => intersectionOverUnion(person.box, candidate.box) > 0.3)) continue;
        selected.push(candidate);
        if (selected.length === 3) break;
    }
    return selected;
}

export const BODY_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
export function landmarkQuality(point) {
    if (!point || ![point.x, point.y, point.visibility, point.presence, ...(point.world || [])].every(Number.isFinite)
        || point.world?.length !== 3 || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return 0;
    return Math.max(0, Math.min(1, point.visibility, point.presence));
}
export function rankPoseCandidates(candidates) {
    return candidates.map(candidate => {
        const values = BODY_LANDMARKS.map(index => landmarkQuality(candidate.landmarks[index]));
        const lowConfidence = BODY_LANDMARKS.filter((_, i) => values[i] < 0.5), visible = values.length - lowConfidence.length;
        // 这是选人启发式，不是坐标正确率。忽略脸部点与Pose总分，防止动物脸误检支配结果。
        const score = 0.7 * values.reduce((sum, value) => sum + value, 0) / values.length
            + 0.2 * visible / values.length + 0.1 * candidate.detection.score;
        const torsoReady = [11, 12, 23, 24].every(index => landmarkQuality(candidate.landmarks[index]) >= 0.5);
        return { ...candidate, quality: { score, visible, total: values.length, lowConfidence, torsoReady } };
    }).sort((a, b) => Number(b.quality.torsoReady) - Number(a.quality.torsoReady)
        || b.quality.score - a.quality.score || b.detection.score - a.detection.score);
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
