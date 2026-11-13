import { normalizeObservation } from './observation-normalizer.js';

const asFrame = (frame) => {
  if (Buffer.isBuffer(frame) || frame instanceof Uint8Array) {
    return { buffer: Buffer.from(frame), observedAt: Date.now(), source: 'external' };
  }
  if (!frame || typeof frame !== 'object' || frame.buffer === undefined) throw new Error('recognizer frame must contain buffer');
  return {
    ...frame,
    observedAt: Number.isFinite(frame.observedAt) ? frame.observedAt : Date.now(),
    source: typeof frame.source === 'string' && frame.source ? frame.source : 'external',
  };
};

const sensorIdsFor = (context) => [
  ...(Array.isArray(context.sensorIds) ? context.sensorIds : []),
  ...(context.sensors && typeof context.sensors === 'object' ? Object.keys(context.sensors) : []),
  ...(context.ocr?.valueKey ? [context.ocr.valueKey] : []),
];

const asRequests = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
};

const ocrRequestFromSensors = (sensors) => Object.entries(sensors ?? {})
  .filter(([, sensor]) => sensor?.detector === 'ocr')
  .map(([sensorId, sensor]) => ({ ...sensor, valueKey: sensor.valueKey ?? sensorId }))
  .at(0);

const valueAt = (root, path) => path.split('.').reduce((value, key) => value?.[key], root);

const evaluatePredicate = (expression, input, context) => {
  if (typeof expression !== 'string') return Boolean(expression);
  const normalized = expression.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  const match = expression.trim().match(/^(values|state)\.([A-Za-z0-9_.-]+)\s*(===|==|!==|!=)\s*(true|false|null|undefined|-?\d+(?:\.\d+)?|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')$/);
  if (!match) return expression.length > 0;
  if (!match) return false;
  const root = match[1] === 'values' ? input.values : (context.state?.values ?? context.state ?? {});
  const raw = valueAt(root, match[2]);
  const actual = raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value') ? raw.value : raw;
  let expected;
  try {
    expected = ['true', 'false', 'null', 'undefined'].includes(match[4])
      ? ({ true: true, false: false, null: null, undefined }[match[4]])
      : (match[4].startsWith('"') ? JSON.parse(match[4]) : (match[4].startsWith("'") ? match[4].slice(1, -1) : Number(match[4])));
  } catch {
    return false;
  }
  if (match[3] === '==' || match[3] === '===') return actual === expected;
  return actual !== expected;
};

/**
 * Compose configured recognition adapters. This class has no action, planning,
 * alert, or input methods: its only result is a normalized observation.
 */
export class Recognizer {
  constructor(options = {}) {
    this.matcher = options.matcher;
    this.ocrClient = options.ocrClient;
    this.yoloDetector = options.yoloDetector;
    this.scriptAdapter = options.scriptAdapter;
    this.now = options.now ?? (() => Date.now());
  }

  async observe(frameValue, context = {}) {
    const frame = asFrame(frameValue);
    const input = {
      observedAt: frame.observedAt ?? this.now(),
      source: frame.source,
      gameTimeHint: context.gameTimeHint,
      sensorIds: sensorIdsFor(context),
      sensors: context.sensors,
      values: { ...(context.values ?? context.state?.values ?? {}) },
    };

    if (this.scriptAdapter && (context.scriptId || context.recognitionScriptId)) {
      const scripted = await this.scriptAdapter.observe(frame, context);
      input.values = { ...input.values, ...(scripted.values ?? {}) };
      if (scripted.ui?.length) input.ui = scripted.ui;
      if (scripted.entities?.length) input.entities = scripted.entities;
      if (scripted.map && Object.keys(scripted.map).length) input.map = scripted.map;
      if (scripted.confidence !== undefined) input.confidence = scripted.confidence;
    }

    if (this.matcher && Array.isArray(context.templates) && context.templates.length) {
      const matches = this.matcher.matchAll
        ? await this.matcher.matchAll(frame.buffer, context.templates, context.matcher ?? 'template')
        : await Promise.all(context.templates.map((template) => this.matcher.match(frame.buffer, template, context.matcher ?? 'template')));
      input.ui = matches.map((match, index) => ({
        id: context.templates[index]?.id ?? context.templates[index]?.descriptor?.name ?? `template-${index}`,
        ...match,
        confidence: match.matched ? match.score : 0,
      }));
      if (this.scriptAdapter?.postprocess) {
        for (const [index, match] of matches.entries()) {
          const template = context.templates[index];
          const scriptId = template?.postprocessScriptId;
          if (!match.matched || !scriptId) continue;
          const processed = await this.scriptAdapter.postprocess(
            frame,
            { id: template.id ?? template.descriptor?.name ?? `template-${index}`, ...match, ...template },
            context,
            scriptId,
          );
          if (processed.values) input.values = { ...input.values, ...processed.values };
          if (processed.entities?.length) input.entities = [...(input.entities ?? []), ...processed.entities];
          if (processed.map && Object.keys(processed.map).length) input.map = { ...(input.map ?? {}), ...processed.map };
        }
      }
    }

    const yoloRequests = [
      ...asRequests(context.yolo),
      ...Object.entries(context.sensors ?? {})
        .filter(([, sensor]) => typeof sensor?.detector === 'string' && sensor.detector.startsWith('yolo:'))
        .map(([sensorId, sensor]) => ({ ...sensor, sensorId, modelId: sensor.modelId ?? sensor.detector.slice(5) })),
    ];
    if (this.yoloDetector && yoloRequests.length) {
      const detections = [];
      for (const request of yoloRequests) {
        const values = await this.yoloDetector.detect(frame.buffer, request.modelId, request.options ?? request);
        detections.push(...(Array.isArray(values) ? values : []));
      }
      input.entities = detections;
    }

    const sensorOcr = ocrRequestFromSensors(context.sensors);
    const ocr = context.ocr ?? sensorOcr;
    const configuredTrigger = ocr?.trigger ?? context.ocrTrigger ?? false;
    const trigger = typeof configuredTrigger === 'function'
      ? await configuredTrigger(input, context)
      : evaluatePredicate(configuredTrigger, input, context);
    const valueKey = ocr?.valueKey ?? sensorOcr?.valueKey;
    if (valueKey && this.ocrClient && trigger) {
      const read = this.ocrClient.read?.bind(this.ocrClient)
        ?? this.ocrClient.recognize?.bind(this.ocrClient);
      if (!read) throw new Error('OCR client must provide read(imageBuffer, options)');
      const result = await read(frame.buffer, ocr.options ?? {});
      const boxes = Array.isArray(result?.boxes) ? result.boxes : [];
      const text = boxes.map((box) => box.text).filter(Boolean).join(' ').trim();
      const scores = boxes.map((box) => box.score).filter(Number.isFinite);
      input.values[valueKey] = {
        value: text || 'unknown',
        confidence: scores.length ? Math.max(...scores) : (text ? 1 : 0),
        ...(result?.imageWidth ? { imageWidth: result.imageWidth } : {}),
        ...(result?.imageHeight ? { imageHeight: result.imageHeight } : {}),
      };
    }

    return normalizeObservation(input);
  }
}

export { normalizeObservation } from './observation-normalizer.js';
export { FrameSource, AdbFrameSource, createFrameSource } from './frame-source.js';
export { decodeImage } from './image-decoder.js';
export { getOpenCv } from './opencv-runtime.js';
export { DepthSource, MotionEstimator } from './depth-source.js';
export { OpenCvImageMatcher } from './image-matcher.js';
export { ScriptRecognitionAdapter, measureColorBarRatio } from './script-recognition.js';
export { BattleHudRecognizer } from './battle-hud-recognizer.js';
export { GameStateRecognizer } from './game-state-recognizer.js';
export { SceneFingerprintClassifier } from './scene-fingerprint-classifier.js';
export { ButtonStateRecognizer } from './button-state-recognizer.js';
export { AdbVideoFrameSource } from './adb-video-frame-source.js';
export { OcrClient } from './ocr-client.js';
export * from './yolo-detector.js';
