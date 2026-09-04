import { readFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-web';
import { decodeImage } from './image-decoder.js';
const DEFAULT_INPUT_SIZE = 640;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.25;
const DEFAULT_IOU_THRESHOLD = 0.45;
const LETTERBOX_VALUE = 114 / 255;
const assertProbability = (value, field) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(field + ' must be between 0 and 1');
    }
};
const resolveInputSize = (model) => {
    if (model.inputSize === undefined) {
        return { width: DEFAULT_INPUT_SIZE, height: DEFAULT_INPUT_SIZE };
    }
    return typeof model.inputSize === 'number'
        ? { width: model.inputSize, height: model.inputSize }
        : model.inputSize;
};
const imageOffset = (x, y, width) => ((y * width) + x) * 4;
export const letterboxImage = (image, inputWidth, inputHeight) => {
    if (image.width <= 0 || image.height <= 0) {
        throw new Error('YOLO input image must have positive dimensions');
    }
    if (!Number.isInteger(inputWidth) || inputWidth <= 0
        || !Number.isInteger(inputHeight) || inputHeight <= 0) {
        throw new Error('YOLO input dimensions must be positive integers');
    }
    const scale = Math.min(inputWidth / image.width, inputHeight / image.height);
    const resizedWidth = Math.max(1, Math.round(image.width * scale));
    const resizedHeight = Math.max(1, Math.round(image.height * scale));
    const padX = Math.floor((inputWidth - resizedWidth) / 2);
    const padY = Math.floor((inputHeight - resizedHeight) / 2);
    const planeSize = inputWidth * inputHeight;
    const data = new Float32Array(planeSize * 3);
    data.fill(LETTERBOX_VALUE);
    for (let y = 0; y < resizedHeight; y += 1) {
        const sourceY = Math.min(image.height - 1, Math.max(0, Math.floor(y / scale)));
        for (let x = 0; x < resizedWidth; x += 1) {
            const sourceX = Math.min(image.width - 1, Math.max(0, Math.floor(x / scale)));
            const source = imageOffset(sourceX, sourceY, image.width);
            const target = ((y + padY) * inputWidth) + x + padX;
            data[target] = image.data[source] / 255;
            data[planeSize + target] = image.data[source + 1] / 255;
            data[(2 * planeSize) + target] = image.data[source + 2] / 255;
        }
    }
    return { data, scale, padX, padY };
};
const scoreValue = (value) => {
    if (value >= 0 && value <= 1) {
        return value;
    }
    return 1 / (1 + Math.exp(-value));
};
const intersectionOverUnion = (left, right) => {
    const x1 = Math.max(left.bounds.x, right.bounds.x);
    const y1 = Math.max(left.bounds.y, right.bounds.y);
    const x2 = Math.min(left.bounds.x + left.bounds.width, right.bounds.x + right.bounds.width);
    const y2 = Math.min(left.bounds.y + left.bounds.height, right.bounds.y + right.bounds.height);
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const leftArea = left.bounds.width * left.bounds.height;
    const rightArea = right.bounds.width * right.bounds.height;
    const union = leftArea + rightArea - intersection;
    return union > 0 ? intersection / union : 0;
};
const nonMaximumSuppression = (detections, iouThreshold) => {
    const pending = [...detections].sort((left, right) => (right.confidence - left.confidence));
    const kept = [];
    while (pending.length > 0) {
        const current = pending.shift();
        if (!current) {
            break;
        }
        kept.push(current);
        for (let index = pending.length - 1; index >= 0; index -= 1) {
            const candidate = pending[index];
            if (candidate.classId === current.classId
                && intersectionOverUnion(current, candidate) > iouThreshold) {
                pending.splice(index, 1);
            }
        }
    }
    return kept;
};
const outputShape = (data, dims) => {
    const shape = dims.length === 3 && dims[0] === 1 ? dims.slice(1) : dims;
    if (shape.length !== 2 || !Number.isInteger(shape[0]) || !Number.isInteger(shape[1])) {
        throw new Error('YOLO output must have shape [1, channels, anchors]');
    }
    const [channels, anchors] = shape;
    if (channels < 5 || anchors <= 0 || data.length < channels * anchors) {
        throw new Error('YOLO output tensor has an invalid shape');
    }
    return { channels, anchors };
};
export const decodeYolo11Output = (data, dims, context) => {
    const { channels, anchors } = outputShape(data, dims);
    const scale = context.scale
        ?? Math.min(context.inputWidth / context.imageWidth, context.inputHeight / context.imageHeight);
    const resizedWidth = Math.max(1, Math.round(context.imageWidth * scale));
    const resizedHeight = Math.max(1, Math.round(context.imageHeight * scale));
    const padX = context.padX ?? Math.floor((context.inputWidth - resizedWidth) / 2);
    const padY = context.padY ?? Math.floor((context.inputHeight - resizedHeight) / 2);
    const classCount = channels - 4;
    const detections = [];
    for (let anchor = 0; anchor < anchors; anchor += 1) {
        let classId = 0;
        let confidence = scoreValue(Number(data[(4 * anchors) + anchor]));
        for (let candidate = 1; candidate < classCount; candidate += 1) {
            const candidateConfidence = scoreValue(Number(data[((4 + candidate) * anchors) + anchor]));
            if (candidateConfidence > confidence) {
                classId = candidate;
                confidence = candidateConfidence;
            }
        }
        if (confidence < context.confidenceThreshold) {
            continue;
        }
        const centerX = Number(data[anchor]);
        const centerY = Number(data[anchors + anchor]);
        const width = Number(data[(2 * anchors) + anchor]);
        const height = Number(data[(3 * anchors) + anchor]);
        const left = Math.max(0, Math.min(context.imageWidth, (centerX - (width / 2) - padX) / scale));
        const top = Math.max(0, Math.min(context.imageHeight, (centerY - (height / 2) - padY) / scale));
        const right = Math.max(0, Math.min(context.imageWidth, (centerX + (width / 2) - padX) / scale));
        const bottom = Math.max(0, Math.min(context.imageHeight, (centerY + (height / 2) - padY) / scale));
        if (right <= left || bottom <= top) {
            continue;
        }
        detections.push({
            classId,
            label: context.labels[classId] ?? 'class-' + classId,
            confidence,
            bounds: {
                x: Math.round(left),
                y: Math.round(top),
                width: Math.round(right - left),
                height: Math.round(bottom - top),
            },
        });
    }
    return nonMaximumSuppression(detections, context.iouThreshold);
};
const decodeInputImage = (frame) => {
    if (frame.length >= 2 && frame[0] === 0x42 && frame[1] === 0x4d) {
        return decodeImage(frame, 'frame.bmp');
    }
    if (frame.length >= 8
        && frame[0] === 0x89 && frame[1] === 0x50
        && frame[2] === 0x4e && frame[3] === 0x47) {
        return decodeImage(frame, 'frame.png');
    }
    throw new Error('YOLO supports PNG and BMP screenshots');
};
const parseLabelsPayload = (payload) => {
    if (Array.isArray(payload) && payload.every((label) => typeof label === 'string')) {
        return payload;
    }
    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
        const names = payload.names;
        if (Array.isArray(names) && names.every((label) => typeof label === 'string')) {
            return names;
        }
    }
    throw new Error('YOLO labels file must contain a string array or a names array');
};
const defaultLabelsLoader = async (model) => {
    if (model.labels) {
        return [...model.labels];
    }
    if (!model.labelsPath) {
        return [];
    }
    const payload = JSON.parse(await readFile(model.labelsPath, 'utf8'));
    return parseLabelsPayload(payload);
};
export class OnnxYoloBackend {
    id = 'onnx-yolo11';
    runtime;
    executionProviders;
    sessionFactory;
    labelsLoader;
    sessions = new Map();
    constructor(options = {}) {
        this.runtime = options.runtime ?? ort;
        this.executionProviders = options.executionProviders ?? ['wasm'];
        this.sessionFactory = options.sessionFactory
            ?? ((modelPath, executionProviders) => this.runtime.InferenceSession.create(modelPath, { executionProviders }));
        this.labelsLoader = options.labelsLoader ?? defaultLabelsLoader;
    }
    async detect(frame, model, options = {}) {
        if (model.task !== 'detect') {
            throw new Error('onnx-yolo11 backend currently supports detect models only');
        }
        const image = decodeInputImage(frame);
        const inputSize = resolveInputSize(model);
        const letterbox = letterboxImage(image, inputSize.width, inputSize.height);
        const session = await this.getSession(model.modelPath);
        const inputName = session.inputNames[0];
        const outputName = session.outputNames[0];
        if (!inputName || !outputName) {
            throw new Error('YOLO ONNX model must have one input and one output');
        }
        const tensor = new this.runtime.Tensor('float32', letterbox.data, [1, 3, inputSize.height, inputSize.width]);
        const outputs = await session.run({ [inputName]: tensor });
        const output = outputs[outputName];
        if (!output || !output.data || !output.dims) {
            throw new Error('YOLO ONNX model returned no output tensor');
        }
        const labels = await this.labelsLoader(model);
        const confidenceThreshold = options.confidenceThreshold
            ?? model.confidenceThreshold
            ?? DEFAULT_CONFIDENCE_THRESHOLD;
        const iouThreshold = options.iouThreshold
            ?? model.iouThreshold
            ?? DEFAULT_IOU_THRESHOLD;
        assertProbability(confidenceThreshold, 'YOLO confidence threshold');
        assertProbability(iouThreshold, 'YOLO IoU threshold');
        return decodeYolo11Output(output.data, output.dims, {
            imageWidth: image.width,
            imageHeight: image.height,
            inputWidth: inputSize.width,
            inputHeight: inputSize.height,
            labels,
            confidenceThreshold,
            iouThreshold,
            scale: letterbox.scale,
            padX: letterbox.padX,
            padY: letterbox.padY,
        });
    }
    getSession(modelPath) {
        let session = this.sessions.get(modelPath);
        if (!session) {
            session = this.sessionFactory(modelPath, this.executionProviders);
            this.sessions.set(modelPath, session);
        }
        return session;
    }
}
