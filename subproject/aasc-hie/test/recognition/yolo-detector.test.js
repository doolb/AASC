import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  LocalYoloDetector,
  OnnxYoloBackend,
  YoloModelRegistry,
} from '../../src/recognition/yolo-detector.js';

const image = () => {
  const value = new PNG({ width: 4, height: 4 });
  for (let offset = 0; offset < value.data.length; offset += 4) {
    value.data[offset] = 255;
    value.data[offset + 1] = 20;
    value.data[offset + 2] = 10;
    value.data[offset + 3] = 255;
  }
  return PNG.sync.write(value);
};

const model = (overrides = {}) => ({
  id: 'enemy-hero',
  task: 'detect',
  backend: 'onnx-yolo11',
  modelPath: '/models/enemy-hero.onnx',
  labels: ['enemy', 'ally'],
  inputSize: 4,
  confidenceThreshold: 0.5,
  iouThreshold: 0.5,
  ...overrides,
});

describe('YoloModelRegistry', () => {
  it('registers models and selects the first model as the default', () => {
    const registry = new YoloModelRegistry([model()]);

    expect(registry.getDefault()).toMatchObject({ id: 'enemy-hero', modelPath: '/models/enemy-hero.onnx' });
    expect(registry.list()).toHaveLength(1);
  });

  it('accepts segmentation models as a configurable task', () => {
    const registry = new YoloModelRegistry([model({ id: 'road-segmentation', task: 'segment' })]);

    expect(registry.get('road-segmentation')).toMatchObject({ id: 'road-segmentation', task: 'segment' });
  });
});

describe('OnnxYoloBackend through LocalYoloDetector', () => {
  it('preprocesses a frame, decodes output, and applies class-aware NMS', async () => {
    let receivedTensor;
    const session = {
      inputNames: ['images'],
      outputNames: ['output'],
      run: async (inputs) => {
        receivedTensor = inputs.images;
        return {
          output: {
            // Two overlapping enemy boxes; the lower-confidence one must be suppressed.
            data: new Float32Array([2, 2.2, 2, 2.2, 2, 2.2, 2, 2.2, 0.9, 0.8, 0.1, 0.1]),
            dims: [1, 6, 2],
          },
        };
      },
    };
    const backend = new OnnxYoloBackend({
      runtime: { Tensor: class Tensor {
        constructor(type, data, dims) {
          this.type = type;
          this.data = data;
          this.dims = dims;
        }
      } },
      sessionFactory: async () => session,
    });
    const registry = new YoloModelRegistry([model()]);
    const detector = new LocalYoloDetector({ registry, backends: [backend] });

    await expect(detector.detect(image(), 'enemy-hero')).resolves.toMatchObject([{
      classId: 0,
      label: 'enemy',
      confidence: expect.closeTo(0.9, 5),
      bounds: { x: 1, y: 1, width: 2, height: 2 },
    }]);
    expect(receivedTensor).toMatchObject({ type: 'float32', dims: [1, 3, 4, 4] });
    expect(receivedTensor.data).toHaveLength(48);
    expect(receivedTensor.data[0]).toBeCloseTo(1);
  });

  it('uses package-configured crop, scale, and padding for inverse coordinate mapping', async () => {
    const session = {
      inputNames: ['images'],
      outputNames: ['output'],
      run: async () => ({
        output: {
          data: new Float32Array([4, 6, 4, 4, 0.95]),
          dims: [1, 5, 1],
        },
      }),
    };
    const backend = new OnnxYoloBackend({
      runtime: { Tensor: class Tensor {} },
      sessionFactory: async () => session,
    });
    const registry = new YoloModelRegistry([model({
      inputSize: 8,
      preprocessing: {
        mode: 'stretch',
        scale: 2,
        padding: { x: 2, y: 4 },
        crop: { x: 1, y: 1, width: 2, height: 2 },
      },
    })]);
    const detector = new LocalYoloDetector({ registry, backends: [backend] });

    await expect(detector.detect(image(), 'enemy-hero')).resolves.toMatchObject([{
      bounds: { x: 1, y: 1, width: 2, height: 2 },
    }]);
  });

  it('delegates segmentation output decoding to the configured model adapter', async () => {
    const session = {
      inputNames: ['images'],
      outputNames: ['output'],
      run: async () => ({ output: { data: new Float32Array([1]), dims: [1, 1, 1] } }),
    };
    const backend = new OnnxYoloBackend({
      runtime: { Tensor: class Tensor {} },
      sessionFactory: async () => session,
      segmentDecoder: ({ model, confidenceThreshold, output }) => [{
        label: model.labels[0], confidence: confidenceThreshold, mask: output.data,
      }],
    });
    const detector = new LocalYoloDetector({ registry: new YoloModelRegistry([model({ id: 'road-segmentation', task: 'segment', labels: ['road'] })]), backends: [backend] });

    await expect(detector.detect(image(), 'road-segmentation', { confidenceThreshold: 0.8 })).resolves.toMatchObject([
      { label: 'road', confidence: 0.8, mask: expect.any(Float32Array) },
    ]);
  });
});
