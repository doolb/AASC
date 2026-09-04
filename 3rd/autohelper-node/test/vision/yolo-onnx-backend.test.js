import { describe, expect, it } from 'vitest';
import { decodeYolo11Output, letterboxImage, } from '../../src/vision/yolo-onnx-backend.js';
const context = {
    imageWidth: 100,
    imageHeight: 100,
    inputWidth: 100,
    inputHeight: 100,
    labels: ['person', 'car'],
    confidenceThreshold: 0.5,
    iouThreshold: 0.5,
};
describe('YOLO11 ONNX helpers', () => {
    it('decodes YOLO11 xywh output and applies class-aware NMS', () => {
        const data = new Float32Array([
            50, 52,
            50, 52,
            20, 20,
            20, 20,
            0.9, 0.8,
            0.1, 0.1,
        ]);
        const detections = decodeYolo11Output(data, [1, 6, 2], context);
        expect(detections).toHaveLength(1);
        expect(detections[0]).toMatchObject({
            classId: 0,
            label: 'person',
            confidence: expect.closeTo(0.9, 5),
            bounds: { x: 40, y: 40, width: 20, height: 20 },
        });
    });
    it('reverses letterbox padding when mapping detections back to the screenshot', () => {
        const mapped = decodeYolo11Output(new Float32Array([
            50,
            50,
            20,
            20,
            0.9,
        ]), [1, 5, 1], {
            ...context,
            imageWidth: 200,
            imageHeight: 100,
            inputWidth: 100,
            inputHeight: 100,
        });
        expect(mapped[0].bounds).toEqual({ x: 80, y: 30, width: 40, height: 40 });
    });
    it('creates an RGB NCHW tensor with gray letterbox padding', () => {
        const rgba = new Uint8Array([
            255, 0, 0, 255,
            0, 255, 0, 255,
        ]);
        const result = letterboxImage({ width: 2, height: 1, data: rgba }, 4, 4);
        expect(result.data.length).toBe(3 * 4 * 4);
        expect(result.scale).toBe(2);
        expect(result.padX).toBe(0);
        expect(result.padY).toBe(1);
        expect(result.data[0]).toBeCloseTo(114 / 255);
        expect(result.data[4]).toBeCloseTo(1);
        expect(result.data[4 * 4 + 6]).toBeCloseTo(1);
        expect(result.data[2 * 4 * 4 + 4]).toBeCloseTo(0);
    });
});
