const assertProbability = (value, field) => {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
        throw new Error(field + ' must be between 0 and 1');
    }
};
const validateModel = (model) => {
    if (!model.id.trim()) {
        throw new Error('YOLO model id is required');
    }
    if (!model.backend.trim()) {
        throw new Error('YOLO model backend is required');
    }
    if (!model.modelPath.trim()) {
        throw new Error('YOLO model path is required');
    }
    if (model.inputSize !== undefined) {
        const size = typeof model.inputSize === 'number'
            ? { width: model.inputSize, height: model.inputSize }
            : model.inputSize;
        if (!Number.isInteger(size.width) || size.width <= 0
            || !Number.isInteger(size.height) || size.height <= 0) {
            throw new Error('YOLO input size must be positive integers');
        }
    }
    assertProbability(model.confidenceThreshold, 'YOLO confidence threshold');
    assertProbability(model.iouThreshold, 'YOLO IoU threshold');
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
        for (const model of models) {
            this.register(model);
        }
    }
    register(model) {
        const validated = validateModel(model);
        if (this.models.has(validated.id)) {
            throw new Error('YOLO model is already registered: ' + validated.id);
        }
        this.models.set(validated.id, validated);
        this.defaultModelId ??= validated.id;
    }
    get(modelId) {
        const model = this.models.get(modelId);
        if (!model) {
            throw new Error('YOLO model is not registered: ' + modelId);
        }
        return model;
    }
    getDefault() {
        if (!this.defaultModelId) {
            throw new Error('no YOLO model is registered');
        }
        return this.get(this.defaultModelId);
    }
    list() {
        return [...this.models.values()].map((model) => ({
            ...model,
            labels: model.labels ? [...model.labels] : undefined,
        }));
    }
}
export class LocalYoloDetector {
    options;
    backends;
    constructor(options) {
        this.options = options;
        this.backends = new Map();
        for (const backend of options.backends) {
            if (!backend.id.trim()) {
                throw new Error('YOLO backend id is required');
            }
            if (this.backends.has(backend.id)) {
                throw new Error('YOLO backend is already registered: ' + backend.id);
            }
            this.backends.set(backend.id, backend);
        }
    }
    async detect(frame, options = {}) {
        const model = options.modelId
            ? this.options.registry.get(options.modelId)
            : this.options.registry.getDefault();
        const backend = this.backends.get(model.backend);
        if (!backend) {
            throw new Error('YOLO backend is not registered: ' + model.backend);
        }
        return await backend.detect(frame, model, options);
    }
    listModels() {
        return this.options.registry.list();
    }
}
