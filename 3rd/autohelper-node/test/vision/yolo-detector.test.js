import { describe, expect, it } from 'vitest';
import { LocalYoloDetector, YoloModelRegistry, } from '../../src/vision/yolo-detector.js';
const detection = {
    classId: 0,
    label: 'person',
    confidence: 0.91,
    bounds: { x: 10, y: 20, width: 30, height: 40 },
};
describe('YoloModelRegistry', () => {
    it('registers extensible model definitions and selects a default', () => {
        const registry = new YoloModelRegistry();
        registry.register({
            id: 'game-ui',
            task: 'detect',
            backend: 'fake',
            modelPath: '/models/game-ui.onnx',
            labels: ['person'],
        });
        expect(registry.getDefault().id).toBe('game-ui');
        expect(registry.get('game-ui')).toMatchObject({
            task: 'detect',
            backend: 'fake',
            modelPath: '/models/game-ui.onnx',
        });
        expect(registry.list()).toHaveLength(1);
    });
    it('rejects duplicate model ids and unknown models', () => {
        const registry = new YoloModelRegistry();
        registry.register({
            id: 'first',
            task: 'segment',
            backend: 'custom-segmentation',
            modelPath: '/models/first.onnx',
        });
        expect(() => registry.register({
            id: 'first',
            task: 'detect',
            backend: 'fake',
            modelPath: '/models/second.onnx',
        })).toThrow('already registered');
        expect(() => registry.get('missing')).toThrow('YOLO model is not registered: missing');
    });
});
describe('LocalYoloDetector', () => {
    it('routes a frame to the backend selected by the model', async () => {
        let receivedModel = '';
        let receivedFrame = Buffer.alloc(0);
        const backend = {
            id: 'fake',
            detect: async (frame, model) => {
                receivedFrame = frame;
                receivedModel = model.id;
                return [detection];
            },
        };
        const registry = new YoloModelRegistry();
        registry.register({
            id: 'game-ui',
            task: 'detect',
            backend: 'fake',
            modelPath: '/models/game-ui.onnx',
            labels: ['person'],
        });
        const detector = new LocalYoloDetector({
            registry,
            backends: [backend],
        });
        const frame = Buffer.from('png');
        await expect(detector.detect(frame, { modelId: 'game-ui' })).resolves.toEqual([detection]);
        expect(receivedModel).toBe('game-ui');
        expect(receivedFrame).toBe(frame);
    });
    it('keeps segmentation models extensible through a custom backend', async () => {
        const backend = {
            id: 'custom-segmentation',
            detect: async () => [{
                    ...detection,
                    mask: { width: 2, height: 2, data: new Uint8Array([1, 0, 1, 0]) },
                }],
        };
        const registry = new YoloModelRegistry();
        registry.register({
            id: 'terrain',
            task: 'segment',
            backend: backend.id,
            modelPath: '/models/terrain.onnx',
        });
        await expect(new LocalYoloDetector({ registry, backends: [backend] })
            .detect(Buffer.from('frame'), { modelId: 'terrain' }))
            .resolves.toMatchObject([{ mask: { width: 2, height: 2 } }]);
    });
});
