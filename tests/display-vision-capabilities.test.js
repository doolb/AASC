'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('服务端和控制端应展示显示端 OCR 与 YOLO11n 能力', () => {
    const server = read('src/apps/server/boot/server-app.js');
    const deviceList = read('src/apps/web-mediacenter/ui/public/js/device-list.js');

    assert.match(server, /caps\.ocrAvailable/);
    assert.match(server, /caps\.yolo11nAvailable/);
    assert.match(server, /图像文字识别（OCR）/);
    assert.match(server, /目标检测（YOLO11n）/);
    assert.match(deviceList, /ocrAvailable/);
    assert.match(deviceList, /yolo11nAvailable/);
    assert.match(deviceList, /RapidOCR/);
    assert.match(deviceList, /YOLO11n/);
});
