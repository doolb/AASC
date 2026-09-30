'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const quality = require('../3rd/mind-basic/mind-basic-quality.js');
const transform = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 1000]];
const projection = [[1000, 0, 320], [0, 1000, 240], [0, 0, 1]];
function input() {
  const worldCoords = Array.from({ length: 12 }, (_, i) => ({ x: (i % 4) * 30, y: Math.floor(i / 4) * 40, z: 0 }));
  return { features: { worldCoords, screenCoords: worldCoords.map((p) => ({ x: p.x + 320, y: p.y + 240 })) },
    transform, projection, totalPoints: 12, dimensions: [100, 100], inputWidth: 640, inputHeight: 480 };
}

test('质量统计使用真实点数、比例、分布和拟合误差，完美分布达到100分', () => {
  const data = input();
  const original = structuredClone(data);
  const result = quality.measure(data);
  assert.equal(result.points, 12);
  assert.equal(result.ratio, 1);
  assert.equal(result.rmse, 0);
  assert.equal(result.coverage, 0.72);
  assert.equal(result.score, 100);
  assert.deepEqual(data, original, '统计不得改写官方点对或矩阵');
});

test('少点、低比例、集中分布和高误差降低评分，分辨率归一化一致', () => {
  const sparse = input(); sparse.totalPoints = 48;
  assert.equal(quality.measure(sparse).score, 50);
  const few = input(); few.features.worldCoords.length = 4; few.features.screenCoords.length = 4;
  assert.ok(quality.measure(few).score < 34);
  const bad = input(); bad.features.screenCoords.forEach((p) => { p.x += 6; });
  assert.equal(quality.measure(bad).rmse, 6);
  assert.ok(quality.measure(bad).score < 15);
  const big = structuredClone(bad);
  big.inputWidth *= 2; big.inputHeight *= 2;
  big.projection[0] = big.projection[0].map((v) => v * 2);
  big.projection[1] = big.projection[1].map((v) => v * 2);
  big.features.screenCoords.forEach((p) => { p.x *= 2; p.y *= 2; });
  assert.equal(quality.measure(big).score, quality.measure(bad).score);
});

test('失败位姿分数为零，缺失或损坏指标返回不可用', () => {
  assert.equal(quality.measure({ ...input(), transform: null }).score, 0);
  assert.equal(quality.measure({ ...input(), totalPoints: undefined }), null);
  assert.equal(quality.measure({ ...input(), dimensions: [0, 100] }), null);
  const bad = input(); bad.features.screenCoords[0].x = NaN;
  assert.equal(quality.measure(bad), null);
  const behind = input(); behind.transform = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, -1000]];
  assert.equal(quality.measure(behind), null);
});

function controllerFixture() {
  const data = input();
  const controller = {
    projectionTransform: projection, markerDimensions: [[100, 100]], inputWidth: 640, inputHeight: 480,
    tracker: { trackingKeyframeList: [{ points: Array(12) }], track() { return data.features; } },
    async _trackAndUpdate(image, previous, index) { this.tracker.track(image, previous, index); return transform; }
  };
  return { controller, data };
}

test('观测包装原样返回结果并保留调用上下文，拆除后恢复方法', async () => {
  const { controller, data } = controllerFixture();
  const samples = [];
  const track = controller.tracker.track, update = controller._trackAndUpdate;
  const detach = quality.attach(controller, (s) => samples.push(s), () => 1234);
  assert.equal(controller.tracker.track(null, null, 0), data.features);
  assert.equal(await controller._trackAndUpdate(null, null, 0), transform);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].timestamp, 1234);
  assert.equal(samples[0].metrics.score, 100);
  detach();
  assert.equal(controller.tracker.track, track);
  assert.equal(controller._trackAndUpdate, update);
});

test('停止后丢弃异步结果，算法异常原样传播，接口缺失不妨碍原算法', async () => {
  const { controller } = controllerFixture();
  let finish;
  controller._trackAndUpdate = async function () {
    this.tracker.track(null, null, 0);
    await new Promise((resolve) => { finish = resolve; });
    return transform;
  };
  const samples = [];
  const detach = quality.attach(controller, (s) => samples.push(s));
  const pending = controller._trackAndUpdate(null, null, 0);
  detach(); finish();
  assert.equal(await pending, transform);
  assert.equal(samples.length, 0);
  const error = new Error('original failure');
  controller._trackAndUpdate = async () => { throw error; };
  const remove = quality.attach(controller, () => {});
  await assert.rejects(controller._trackAndUpdate(), (e) => e === error);
  remove();
  assert.equal(quality.attach({}, () => {}), null);
});
