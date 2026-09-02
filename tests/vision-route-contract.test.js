'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('服务器提供显示端本地推理的统一视觉路由', () => {
  const server = read('src/apps/server/boot/server-app.js');
  assert.match(server, /app\.post\('\/api\/vision\/ocr'/);
  assert.match(server, /app\.post\('\/api\/vision\/yolo'/);
  assert.match(server, /app\.get\('\/api\/vision\/status'/);
  assert.match(server, /pendingDisplayVisionRequests/);
  assert.match(server, /visionOcrResult/);
  assert.match(server, /visionYolo11nResult/);
});

test('显示端把服务器视觉请求转给 NativeDisplay 并回传结果', () => {
  const display = read('src/apps/web-mediacenter/ui/public/display.html');
  assert.match(display, /data\.type === 'visionOcr'/);
  assert.match(display, /data\.type === 'visionYolo11n'/);
  assert.match(display, /NativeDisplay\.ocrRecognizeAsync/);
  assert.match(display, /NativeDisplay\.yolo11nDetectAsync/);
  assert.match(display, /type: 'visionOcrResult'/);
  assert.match(display, /type: 'visionYolo11nResult'/);
});

test('控制端任务面板提供 OCR/YOLO 任务的服务器 URL、图片和显示端参数', () => {
  const taskPanel = read('src/apps/web-mediacenter/ui/public/js/task-panel.js');
  assert.match(taskPanel, /builtinId === 'ocr' \|\| builtinId === 'yolo'/);
  assert.match(taskPanel, /visionServerUrl/);
  assert.match(taskPanel, /visionImageFile/);
  assert.match(taskPanel, /targetDisplay/);
  assert.match(taskPanel, /serverUrl/);
});
