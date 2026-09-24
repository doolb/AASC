'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createRun,
    finishRun,
    recordSample
} = require('../3rd/mmd-ar-test/display-mmd-ar-benchmark-metrics');

test('AR A/B 指标统计首次识别、可见率、丢失、帧率和锚点抖动', () => {
    const run = createRun('current', 100, 0);
    const samples = [
        { timestamp: 200, visible: false, processingMs: 4 },
        { timestamp: 300, visible: true, x: 20, y: 30, processingMs: 5 },
        { timestamp: 400, visible: true, x: 22, y: 34, processingMs: 7 },
        { timestamp: 500, visible: false, processingMs: 3 },
        { timestamp: 600, visible: true, x: 24, y: 32, processingMs: 5 }
    ];

    for (const sample of samples) assert.equal(recordSample(run, sample), true);

    const result = finishRun(run, 700);
    assert.equal(result.engine, 'current');
    assert.equal(result.compilationMs, 0);
    assert.equal(result.firstDetectionMs, 200);
    assert.equal(result.sampleCount, 5);
    assert.equal(result.visiblePercent, 50);
    assert.equal(result.lostCount, 1);
    assert.equal(result.trackingFps, 10);
    assert.equal(result.meanProcessingMs, 4.8);
    assert.ok(Math.abs(result.jitterPx - Math.sqrt(16 / 3)) < 1e-9);
});

test('AR A/B 指标允许 MindAR 没有编译数据时记为未知', () => {
    const result = finishRun(createRun('mindar', 100), 300);
    assert.equal(result.engine, 'mindar');
    assert.equal(result.compilationMs, null);
    assert.equal(result.firstDetectionMs, null);
    assert.equal(result.sampleCount, 0);
    assert.equal(result.visiblePercent, 0);
    assert.equal(result.lostCount, 0);
    assert.equal(result.jitterPx, null);
});

test('AR A/B 可见率按时间加权，避免不同识别帧率造成采样比例偏差', () => {
    const run = createRun('mindar', 0);
    recordSample(run, { timestamp: 100, visible: true });
    recordSample(run, { timestamp: 200, visible: true });
    recordSample(run, { timestamp: 900, visible: false });

    const result = finishRun(run, 1000);
    assert.equal(result.visiblePercent, 80);
    assert.equal(result.trackingFps, 2.5);
});

test('AR A/B 指标忽略无时间戳采样且不允许负耗时', () => {
    const run = createRun('mindar', 10, 25);
    assert.equal(recordSample(run, { visible: true }), false);
    assert.equal(recordSample(run, {
        timestamp: 20,
        visible: true,
        x: 10,
        y: 12,
        processingMs: -10
    }), true);
    const result = finishRun(run, 30);
    assert.equal(result.sampleCount, 1);
    assert.equal(result.meanProcessingMs, 0);
    assert.equal(result.trackingFps, 0);
});
