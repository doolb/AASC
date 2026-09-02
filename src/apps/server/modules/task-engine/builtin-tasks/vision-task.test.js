'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const tasks = [
  ['ocr', './ocr', '/api/vision/ocr'],
  ['yolo', './yolo', '/api/vision/yolo']
];

for (const [id, modulePath, expectedPath] of tasks) {
  test(`${id} 内置任务使用默认本机服务器 URL 调用视觉接口`, async () => {
    const task = require(modulePath);
    const calls = [];
    const result = await task.run({
      taskName: id,
      params: { targetDisplay: 'display-1' },
      files: { 'input.png': Buffer.from([1, 2, 3]) },
      taskIO: {
        async getTaskConfig() { return {}; }
      },
      requestVision: async (request) => {
        calls.push(request);
        return { status: 'success', requestPath: request.path, displayId: request.displayId };
      }
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].serverUrl, 'http://127.0.0.1:8081');
    assert.equal(calls[0].path, expectedPath);
    assert.equal(calls[0].displayId, 'display-1');
    assert.equal(calls[0].image.length, 3);
    assert.equal(result.success, true);
    assert.equal(result.data.status, 'success');
  });
}

test('视觉任务实例参数覆盖服务器 URL 和图片文件名', async () => {
  const task = require('./ocr');
  let request = null;
  await task.run({
    taskName: 'ocr',
    params: {
      serverUrl: 'https://vision.example:8443/',
      targetDisplay: 'display-2',
      imageFileName: 'game.webp'
    },
    files: {
      'input.png': Buffer.from([0]),
      'game.webp': Buffer.from([4, 5])
    },
    taskIO: { async getTaskConfig() { return {}; } },
    requestVision: async (value) => {
      request = value;
      return { status: 'success' };
    }
  });

  assert.equal(request.serverUrl, 'https://vision.example:8443');
  assert.equal(request.displayId, 'display-2');
  assert.deepEqual([...request.image], [4, 5]);
});

test('OCR 任务转发短边参数，YOLO 任务不暴露该参数', async () => {
  const ocrTask = require('./ocr');
  const yoloTask = require('./yolo');
  let ocrRequest = null;
  let yoloRequest = null;
  const context = (taskName, requestVision) => ({
    taskName,
    params: { shortSide: '512' },
    files: { 'input.png': Buffer.from([1]) },
    taskIO: { async getTaskConfig() { return {}; } },
    requestVision: async (request) => {
      requestVision(request);
      return { status: 'success' };
    }
  });

  await ocrTask.run(context('ocr', (request) => { ocrRequest = request; }));
  await yoloTask.run(context('yolo', (request) => { yoloRequest = request; }));

  assert.equal(ocrRequest.shortSide, 512);
  assert.equal(Object.prototype.hasOwnProperty.call(yoloRequest, 'shortSide'), false);
});

test('YOLO 任务默认使用 n，并允许配置更大模型 ID', async () => {
  const task = require('./yolo');
  const calls = [];
  const context = (params) => ({
    taskName: 'yolo',
    params,
    files: { 'input.png': Buffer.from([1]) },
    taskIO: { async getTaskConfig() { return {}; } },
    requestVision: async (request) => {
      calls.push(request);
      return { status: 'success' };
    }
  });

  await task.run(context({}));
  await task.run(context({ model: 'yolo11x' }));

  assert.equal(calls[0].model, 'yolo11n');
  assert.equal(calls[1].model, 'yolo11x');
  assert.deepEqual(task.params.find((param) => param.name === 'model').options, [
    'yolo11n', 'yolo11s', 'yolo11m', 'yolo11l', 'yolo11x'
  ]);
});
