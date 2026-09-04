import { readFile } from 'node:fs/promises';
import { LocalYoloDetector, YoloModelRegistry } from './yolo-detector.js';
import { OnnxYoloBackend } from './yolo-onnx-backend.js';

const modelList = (value) => {
    if (Array.isArray(value))
        return value;
    if (value && typeof value === 'object' && Array.isArray(value.models))
        return value.models;
    throw new Error('YOLO model config must contain a models array');
};

export const createLocalYoloDetector = (models, options = {}) => {
    const registry = new YoloModelRegistry(models);
    const backend = options.backend ?? new OnnxYoloBackend(options.backendOptions);
    return new LocalYoloDetector({
        registry,
        backends: options.backends ?? [backend],
    });
};

export const loadLocalYoloDetector = async (filePath, options = {}) => {
    const value = JSON.parse(await readFile(filePath, 'utf8'));
    return createLocalYoloDetector(modelList(value), options);
};
