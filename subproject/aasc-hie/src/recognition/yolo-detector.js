import { readFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-web';
import { decodeImage } from './image-decoder.js';

const DEFAULT_INPUT_SIZE = 640;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.25;
const DEFAULT_IOU_THRESHOLD = 0.45;
const LETTERBOX_VALUE = 114 / 255;

const probability = (value, field) => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};

const inputSize = (model) => {
  const value = model.inputSize ?? DEFAULT_INPUT_SIZE;
  const size = typeof value === 'number' ? { width: value, height: value } : value;
  if (!Number.isInteger(size?.width) || size.width <= 0 || !Number.isInteger(size?.height) || size.height <= 0) {
    throw new Error('YOLO input size must be positive integers');
  }
  return size;
};

const validateModel = (model) => {
  if (!model || typeof model !== 'object') throw new Error('YOLO model must be an object');
  for (const field of ['id', 'backend', 'modelPath']) {
    if (typeof model[field] !== 'string' || !model[field].trim()) throw new Error(`YOLO ${field} is required`);
  }
  if (model.labels !== undefined && (!Array.isArray(model.labels) || !model.labels.every((label) => typeof label === 'string'))) {
    throw new Error('YOLO labels must be an array of strings');
  }
  if (model.confidenceThreshold !== undefined) probability(model.confidenceThreshold, 'YOLO confidence threshold');
  if (model.iouThreshold !== undefined) probability(model.iouThreshold, 'YOLO IoU threshold');
  inputSize(model);
  return {
    ...model,
    id: model.id.trim(),
    backend: model.backend.trim(),
    modelPath: model.modelPath.trim(),
    labels: model.labels ? [...model.labels] : undefined,
  };
};

export class YoloModelRegistry {
  models = new Map();
  defaultModelId;

  constructor(models = []) {
    if (!Array.isArray(models)) throw new Error('YOLO models must be an array');
    models.forEach((model) => this.register(model));
  }

  register(model) {
    const validated = validateModel(model);
    if (this.models.has(validated.id)) throw new Error(`YOLO model is already registered: ${validated.id}`);
    this.models.set(validated.id, validated);
    this.defaultModelId ??= validated.id;
    return validated;
  }

  get(modelId) {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`YOLO model is not registered: ${modelId}`);
    return model;
  }

  getDefault() {
    if (!this.defaultModelId) throw new Error('no YOLO model is registered');
    return this.get(this.defaultModelId);
  }

  list() {
    return [...this.models.values()].map((model) => ({ ...model, labels: model.labels ? [...model.labels] : undefined }));
  }
}

const imageOffset = (x, y, width) => ((y * width) + x) * 4;

const cropRegion = (image, transform) => {
  const crop = transform.crop ?? { x: 0, y: 0, width: image.width, height: image.height };
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)
    || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0
    || crop.x + crop.width > image.width || crop.y + crop.height > image.height) {
    throw new Error('YOLO crop must be within the source image');
  }
  return crop;
};

const configuredScale = (value) => {
  if (value === undefined) return null;
  if (Number.isFinite(value) && value > 0) return { x: value, y: value };
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x > 0 && value.y > 0) {
    return { x: value.x, y: value.y };
  }
  throw new Error('YOLO transform scale must be positive');
};

const configuredPadding = (transform, mode) => {
  const padding = transform.padding ?? transform.pad;
  const padX = transform.padX ?? (Array.isArray(padding) ? padding[0] : padding?.x);
  const padY = transform.padY ?? (Array.isArray(padding) ? padding[1] : padding?.y);
  if (padX !== undefined || padY !== undefined) {
    if (!Number.isFinite(padX ?? 0) || !Number.isFinite(padY ?? 0) || (padX ?? 0) < 0 || (padY ?? 0) < 0) {
      throw new Error('YOLO transform padding must be non-negative');
    }
    return { x: padX ?? 0, y: padY ?? 0 };
  }
  return mode === 'letterbox' ? null : { x: 0, y: 0 };
};

/** Convert an RGBA image to RGB NCHW data using a configured source transform. */
export const preprocessYoloImage = (image, targetWidth, targetHeight, transform = {}) => {
  if (!Number.isInteger(image?.width) || image.width <= 0 || !Number.isInteger(image?.height) || image.height <= 0) {
    throw new Error('YOLO input image must have positive dimensions');
  }
  if (!Number.isInteger(targetWidth) || targetWidth <= 0 || !Number.isInteger(targetHeight) || targetHeight <= 0) {
    throw new Error('YOLO input dimensions must be positive integers');
  }
  const mode = transform.mode ?? 'letterbox';
  if (!['letterbox', 'stretch', 'crop', 'identity'].includes(mode)) throw new Error(`unsupported YOLO transform mode: ${mode}`);
  const crop = cropRegion(image, transform);
  const scale = configuredScale(transform.scale ?? (transform.scaleX !== undefined || transform.scaleY !== undefined
    ? { x: transform.scaleX ?? transform.scaleY, y: transform.scaleY ?? transform.scaleX } : undefined));
  const resolvedScale = scale ?? (mode === 'stretch' || mode === 'crop'
    ? { x: targetWidth / crop.width, y: targetHeight / crop.height }
    : (mode === 'identity' ? { x: 1, y: 1 } : (() => {
      const value = Math.min(targetWidth / crop.width, targetHeight / crop.height);
      return { x: value, y: value };
    })()));
  const resizedWidth = Math.max(1, Math.round(crop.width * resolvedScale.x));
  const resizedHeight = Math.max(1, Math.round(crop.height * resolvedScale.y));
  const configured = configuredPadding(transform, mode);
  const padX = configured?.x ?? Math.floor((targetWidth - resizedWidth) / 2);
  const padY = configured?.y ?? Math.floor((targetHeight - resizedHeight) / 2);
  if (padX + resizedWidth > targetWidth || padY + resizedHeight > targetHeight) {
    throw new Error('YOLO transform does not fit the model input');
  }
  const planeSize = targetWidth * targetHeight;
  const data = new Float32Array(planeSize * 3);
  data.fill(LETTERBOX_VALUE);
  for (let y = 0; y < resizedHeight; y += 1) {
    const sourceY = Math.min(crop.height - 1, Math.max(0, Math.floor(y / resolvedScale.y))) + crop.y;
    for (let x = 0; x < resizedWidth; x += 1) {
      const sourceX = Math.min(crop.width - 1, Math.max(0, Math.floor(x / resolvedScale.x))) + crop.x;
      const source = imageOffset(sourceX, sourceY, image.width);
      const target = ((y + padY) * targetWidth) + x + padX;
      data[target] = image.data[source] / 255;
      data[planeSize + target] = image.data[source + 1] / 255;
      data[(2 * planeSize) + target] = image.data[source + 2] / 255;
    }
  }
  return {
    data,
    scale: resolvedScale.x === resolvedScale.y ? resolvedScale.x : undefined,
    scaleX: resolvedScale.x,
    scaleY: resolvedScale.y,
    padX,
    padY,
    cropX: crop.x,
    cropY: crop.y,
    mode,
  };
};

/** Backward-compatible centered letterbox preprocessing. */
export const letterboxImage = (image, targetWidth, targetHeight) => (
  preprocessYoloImage(image, targetWidth, targetHeight)
);

const scoreValue = (value) => (value >= 0 && value <= 1 ? value : 1 / (1 + Math.exp(-value)));
const iou = (left, right) => {
  const x1 = Math.max(left.bounds.x, right.bounds.x);
  const y1 = Math.max(left.bounds.y, right.bounds.y);
  const x2 = Math.min(left.bounds.x + left.bounds.width, right.bounds.x + right.bounds.width);
  const y2 = Math.min(left.bounds.y + left.bounds.height, right.bounds.y + right.bounds.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = left.bounds.width * left.bounds.height + right.bounds.width * right.bounds.height - intersection;
  return union > 0 ? intersection / union : 0;
};

const nms = (detections, threshold) => {
  const pending = [...detections].sort((left, right) => right.confidence - left.confidence);
  const kept = [];
  while (pending.length) {
    const current = pending.shift();
    kept.push(current);
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (pending[index].classId === current.classId && iou(current, pending[index]) > threshold) pending.splice(index, 1);
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
  if (channels < 5 || anchors <= 0 || data.length < channels * anchors) throw new Error('YOLO output tensor has an invalid shape');
  return { channels, anchors };
};

export const decodeYolo11Output = (data, dims, context) => {
  const { channels, anchors } = outputShape(data, dims);
  const confidenceThreshold = context.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const iouThreshold = context.iouThreshold ?? DEFAULT_IOU_THRESHOLD;
  probability(confidenceThreshold, 'YOLO confidence threshold');
  probability(iouThreshold, 'YOLO IoU threshold');
  const scaleX = context.scaleX ?? context.scale ?? Math.min(context.inputWidth / context.imageWidth, context.inputHeight / context.imageHeight);
  const scaleY = context.scaleY ?? context.scale ?? Math.min(context.inputWidth / context.imageWidth, context.inputHeight / context.imageHeight);
  if (!Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) throw new Error('YOLO inverse transform scale must be positive');
  const resizedWidth = Math.max(1, Math.round(context.imageWidth * scaleX));
  const resizedHeight = Math.max(1, Math.round(context.imageHeight * scaleY));
  const padX = context.padX ?? Math.floor((context.inputWidth - resizedWidth) / 2);
  const padY = context.padY ?? Math.floor((context.inputHeight - resizedHeight) / 2);
  const cropX = context.cropX ?? context.crop?.x ?? 0;
  const cropY = context.cropY ?? context.crop?.y ?? 0;
  const detections = [];
  for (let anchor = 0; anchor < anchors; anchor += 1) {
    let classId = 0;
    let confidence = scoreValue(Number(data[(4 * anchors) + anchor]));
    for (let candidate = 1; candidate < channels - 4; candidate += 1) {
      const candidateConfidence = scoreValue(Number(data[((4 + candidate) * anchors) + anchor]));
      if (candidateConfidence > confidence) {
        classId = candidate;
        confidence = candidateConfidence;
      }
    }
    if (confidence < confidenceThreshold) continue;
    const centerX = Number(data[anchor]);
    const centerY = Number(data[anchors + anchor]);
    const width = Number(data[(2 * anchors) + anchor]);
    const height = Number(data[(3 * anchors) + anchor]);
    const left = Math.max(0, Math.min(context.imageWidth, (centerX - width / 2 - padX) / scaleX + cropX));
    const top = Math.max(0, Math.min(context.imageHeight, (centerY - height / 2 - padY) / scaleY + cropY));
    const right = Math.max(0, Math.min(context.imageWidth, (centerX + width / 2 - padX) / scaleX + cropX));
    const bottom = Math.max(0, Math.min(context.imageHeight, (centerY + height / 2 - padY) / scaleY + cropY));
    if (right <= left || bottom <= top) continue;
    detections.push({
      classId,
      label: context.labels?.[classId] ?? `class-${classId}`,
      confidence,
      bounds: { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) },
    });
  }
  return nms(detections, iouThreshold);
};

const decodeInputImage = (frame) => {
  if (frame.length >= 2 && frame[0] === 0x42 && frame[1] === 0x4d) return decodeImage(frame, 'frame.bmp');
  if (frame.length >= 8 && frame[0] === 0x89 && frame[1] === 0x50 && frame[2] === 0x4e && frame[3] === 0x47) {
    return decodeImage(frame, 'frame.png');
  }
  throw new Error('YOLO supports PNG and BMP screenshots');
};

const labelsPayload = (payload) => {
  if (Array.isArray(payload) && payload.every((label) => typeof label === 'string')) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.names) && payload.names.every((label) => typeof label === 'string')) return payload.names;
  throw new Error('YOLO labels file must contain a string array or a names array');
};

const defaultLabelsLoader = async (model) => {
  if (model.labels) return [...model.labels];
  if (!model.labelsPath) return [];
  return labelsPayload(JSON.parse(await readFile(model.labelsPath, 'utf8')));
};

export class OnnxYoloBackend {
  id = 'onnx-yolo11';
  sessions = new Map();

  constructor(options = {}) {
    this.runtime = options.runtime ?? ort;
    this.executionProviders = options.executionProviders ?? ['wasm'];
    this.sessionFactory = options.sessionFactory ?? ((modelPath, providers) => this.runtime.InferenceSession.create(modelPath, { executionProviders: providers }));
    this.labelsLoader = options.labelsLoader ?? defaultLabelsLoader;
    this.segmentDecoder = options.segmentDecoder;
  }

  async detect(frame, model, options = {}) {
    if (model.task && !['detect', 'segment'].includes(model.task)) throw new Error(`onnx-yolo11 backend does not support task: ${model.task}`);
    const image = decodeInputImage(frame);
    const size = inputSize(model);
    const transform = model.preprocessing ?? model.coordinateTransform ?? {};
    const preprocessing = preprocessYoloImage(image, size.width, size.height, transform);
    const session = await this.getSession(model.modelPath);
    const inputName = session.inputNames?.[0];
    const outputName = session.outputNames?.[0];
    if (!inputName || !outputName) throw new Error('YOLO ONNX model must have one input and one output');
    const tensor = new this.runtime.Tensor('float32', preprocessing.data, [1, 3, size.height, size.width]);
    const outputs = await session.run({ [inputName]: tensor });
    const output = outputs[outputName];
    if (!output?.data || !output?.dims) throw new Error('YOLO ONNX model returned no output tensor');
    const labels = await this.labelsLoader(model);
    const confidenceThreshold = options.confidenceThreshold ?? model.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const iouThreshold = options.iouThreshold ?? model.iouThreshold ?? DEFAULT_IOU_THRESHOLD;
    probability(confidenceThreshold, 'YOLO confidence threshold');
    probability(iouThreshold, 'YOLO IoU threshold');
    if (model.task === 'segment') {
      if (typeof this.segmentDecoder !== 'function') throw new Error('YOLO segmentation decoder is not configured');
      const decoded = await this.segmentDecoder({
        output,
        image,
        model,
        labels,
        confidenceThreshold,
        iouThreshold,
        preprocessing,
      });
      if (!Array.isArray(decoded)) throw new Error('YOLO segmentation decoder must return an array');
      return decoded;
    }
    return decodeYolo11Output(output.data, output.dims, {
      imageWidth: image.width,
      imageHeight: image.height,
      inputWidth: size.width,
      inputHeight: size.height,
      labels,
      confidenceThreshold,
      iouThreshold,
      scale: preprocessing.scale,
      scaleX: preprocessing.scaleX,
      scaleY: preprocessing.scaleY,
      padX: preprocessing.padX,
      padY: preprocessing.padY,
      cropX: preprocessing.cropX,
      cropY: preprocessing.cropY,
    });
  }

  getSession(modelPath) {
    if (!this.sessions.has(modelPath)) this.sessions.set(modelPath, this.sessionFactory(modelPath, this.executionProviders));
    return this.sessions.get(modelPath);
  }
}

export class YoloDetector {
  constructor(options = {}) {
    this.registry = options.registry ?? new YoloModelRegistry(options.models ?? []);
    this.backends = new Map();
    for (const backend of options.backends ?? (options.backend ? [options.backend] : [])) {
      if (!backend || typeof backend.id !== 'string' || !backend.id.trim()) throw new Error('YOLO backend id is required');
      if (this.backends.has(backend.id)) throw new Error(`YOLO backend is already registered: ${backend.id}`);
      this.backends.set(backend.id, backend);
    }
  }

  async detect(frame, modelId, options = {}) {
    const request = modelId && typeof modelId === 'object' ? modelId : { ...options, modelId };
    const model = request.modelId ? this.registry.get(request.modelId) : this.registry.getDefault();
    const backend = this.backends.get(model.backend);
    if (!backend) throw new Error(`YOLO backend is not registered: ${model.backend}`);
    return await backend.detect(frame, model, request);
  }

  listModels() {
    return this.registry.list();
  }
}

export class LocalYoloDetector extends YoloDetector {}

export const createLocalYoloDetector = (models, options = {}) => {
  const registry = new YoloModelRegistry(models);
  const backend = options.backend ?? new OnnxYoloBackend(options.backendOptions);
  return new LocalYoloDetector({ registry, backends: options.backends ?? [backend] });
};

export const loadLocalYoloDetector = async (filePath, options = {}) => {
  const value = JSON.parse(await readFile(filePath, 'utf8'));
  const models = Array.isArray(value) ? value : value?.models;
  if (!Array.isArray(models)) throw new Error('YOLO model config must contain a models array');
  return createLocalYoloDetector(models, options);
};
