import { describe, expect, it } from 'vitest';
import { resolveClickPoint, selectAction } from '../../src/runtime/action-selector.js';
const descriptor = (name, queue = 0, options = {}) => ({
    name,
    flowId: 'home',
    filePath: `/tmp/${name}.png`,
    queue,
    threshold: 0.9,
    clickPoint: { x: 0.5, y: 0.5 },
    centerClick: false,
    delayMs: 0,
    loop: false,
    wait: false,
    defaultCandidate: false,
    ...options,
});
const result = (score, rect = { x: 10, y: 20, width: 40, height: 80 }) => ({
    score,
    rect,
    matched: true,
    method: 'template',
});
const candidate = (name, queue, score, options = {}) => ({
    descriptor: descriptor(name, queue, options),
    match: result(score),
});
describe('action selector', () => {
    it('ranks by queue first and score second', () => {
        const selected = selectAction([
            candidate('low-queue', 1, 0.99),
            candidate('high-queue', 10, 0.91),
        ], new Map());
        expect(selected?.descriptor.name).toBe('high-queue');
    });
    it('requires selectImage to be matched in the same flow', () => {
        const selected = selectAction([
            candidate('button', 1, 0.95, { selectImage: 'confirm' }),
        ], new Map([
            ['button', result(0.95)],
            ['confirm', result(0.90)],
        ]));
        expect(selected?.descriptor.name).toBe('button');
    });
    it('uses default candidates only when ordinary candidates are absent', () => {
        const selected = selectAction([
            candidate('default', 100, 0.99, { defaultCandidate: true }),
            candidate('ordinary', 1, 0.91),
        ], new Map());
        expect(selected?.descriptor.name).toBe('ordinary');
    });
    it('calculates normalized and center click points inside the frame', () => {
        expect(resolveClickPoint(descriptor('button', 0, { clickPoint: { x: 0.75, y: 0.25 } }), { x: 10, y: 20, width: 40, height: 80 }, { width: 100, height: 100 })).toEqual({ x: 40, y: 40 });
        expect(resolveClickPoint(descriptor('center', 0, { centerClick: true }), { x: 10, y: 20, width: 40, height: 80 }, { width: 100, height: 100 })).toEqual({ x: 50, y: 50 });
    });
    it('ignores negative queues and unmatched candidates', () => {
        const selected = selectAction([
            candidate('negative', -10, 1),
            { descriptor: descriptor('unmatched'), match: { ...result(0.2), matched: false, rect: null } },
            candidate('valid', 0, 0.9),
        ], new Map());
        expect(selected?.descriptor.name).toBe('valid');
    });
    it('requires OCR text for candidates that declare an OCR condition', () => {
        const candidates = [
            candidate('ocr-button', 10, 0.91, { ocrText: '放弃福利' }),
            candidate('fallback', 1, 0.99),
        ];
        const ocr = {
            boxes: [{ text: '确认：放弃福利', score: 0.98, points: [] }],
        };
        expect(selectAction(candidates, new Map(), ocr)?.descriptor.name).toBe('ocr-button');
        expect(selectAction([candidates[0]], new Map(), { boxes: [] })).toBeNull();
    });
});
