import { BODY_LANDMARKS, landmarkQuality, rankPoseCandidates } from './web-human-pose-core.mjs';

// 固定Body7 m384权重的真实输入/输出契约。模型包中旧pipeline尺寸字段不能替代ONNX实际尺寸。
const WIDTH = 288, HEIGHT = 384;
const MEAN = [123.675, 116.28, 103.53], STD = [58.395, 57.12, 57.375];
const SEMANTICS = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export function prepareRTMPose(image) {
    if (!Number.isInteger(image?.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1
        || image.width * image.height > 4096 * 4096 || image.data?.length !== image.width * image.height * 4) throw new Error('图片尺寸或像素无效');
    let width = image.width, height = image.height;
    if (width / height > WIDTH / HEIGHT) height = width * HEIGHT / WIDTH;
    else width = height * WIDTH / HEIGHT;
    width *= 1.25; height *= 1.25;
    const cx = image.width / 2, cy = image.height / 2, tensor = new Float32Array(3 * WIDTH * HEIGHT);
    const pixel = (x, y, channel) => x >= 0 && x < image.width && y >= 0 && y < image.height ? image.data[(y * image.width + x) * 4 + channel] : 0;
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
        // 对齐cv2.warpAffine的像素中心定义；四个邻点分别判断边界，黑边也参与双线性插值。
        const sx = cx + (x - WIDTH / 2) * width / WIDTH, sy = cy + (y - HEIGHT / 2) * height / HEIGHT;
        const x0 = Math.floor(sx), y0 = Math.floor(sy), a = sx - x0, b = sy - y0;
        for (let c = 0; c < 3; c++) {
            const value = (pixel(x0, y0, c) * (1 - a) + pixel(x0 + 1, y0, c) * a) * (1 - b)
                + (pixel(x0, y0 + 1, c) * (1 - a) + pixel(x0 + 1, y0 + 1, c) * a) * b;
            tensor[c * WIDTH * HEIGHT + y * WIDTH + x] = (value - MEAN[c]) / STD[c];
        }
    }
    return { tensor, cx, cy, width, height };
}

export function decodeRTMPose(x, y, roi, image) {
    const valid = (tensor, length) => tensor?.dims?.join(',') === `1,17,${length}`
        && tensor.data?.length === 17 * length && tensor.data.every(Number.isFinite);
    if (!valid(x, 576) || !valid(y, 768)) throw new Error('RTMPose模型输出维度或数值无效');
    const peak = (values, start, length) => {
        let index = 0, value = -Infinity;
        for (let i = 0; i < length; i++) if (values[start + i] > value) { index = i; value = values[start + i]; }
        return { index, value };
    };
    const landmarks = Array(33).fill(null);
    SEMANTICS.forEach((semantic, i) => {
        const a = peak(x.data, i * 576, 576), b = peak(y.data, i * 768, 768);
        // rtmlib RTMPose约定为两个最大值的均值，不能套用DWPose的min，也不能当概率。
        const score = Math.max(0, Math.min(1, (a.value + b.value) / 2));
        landmarks[semantic] = { x: (roi.cx + (a.index / 2 - WIDTH / 2) * roi.width / WIDTH) / image.width,
            y: (roi.cy + (b.index / 2 - HEIGHT / 2) * roi.height / HEIGHT) / image.height,
            visibility: score, presence: score, source: 'rtmpose-m', dimensions: 2 };
    });
    const reliable = BODY_LANDMARKS.map(i => landmarks[i]).filter(p => landmarkQuality(p) >= .3);
    if (reliable.length < 6 || Math.max(...reliable.map(p => p.x)) - Math.min(...reliable.map(p => p.x)) < .025
        || Math.max(...reliable.map(p => p.y)) - Math.min(...reliable.map(p => p.y)) < .05) throw new Error('未识别到可靠姿态，请使用清晰的单人全身图片');
    return rankPoseCandidates([{ source: 'rtmpose-m', dimensions: 2, imageAspect: image.width / image.height,
        landmarks, confidence: reliable.reduce((sum, p) => sum + landmarkQuality(p), 0) / reliable.length,
        framing: 'full-image' }])[0];
}
