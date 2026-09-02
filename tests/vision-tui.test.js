'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const viewer = path.join(root, 'scripts', 'api', 'vision-tui.js');

function render(payload, kind) {
    return spawnSync(process.execPath, [viewer, '--kind', kind], {
        cwd: root,
        encoding: 'utf8',
        input: JSON.stringify(payload)
    });
}

test('视觉 TUI 将 OCR 返回内容、文字框和位置图输出为可读面板', () => {
    const result = render({
        status: 'success',
        success: true,
        kind: 'ocr',
        displayId: 'display-1',
        imageWidth: 1200,
        imageHeight: 800,
        elapsedMs: 42,
        text: '你好 AASC',
        boxes: [{
            text: '你好',
            score: 0.987,
            points: [[100, 100], [400, 100], [400, 180], [100, 180]]
        }]
    }, 'ocr');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OCR 识别结果/);
    assert.match(result.stdout, /你好 AASC/);
    assert.match(result.stdout, /文字框.*1/);
    assert.match(result.stdout, /0\.987/);
    assert.match(result.stdout, /位置图/);
    assert.match(result.stdout, /[+|]/);
});

test('视觉 TUI 将 YOLO 返回内容、检测框和坐标输出为可读面板', () => {
    const result = render({
        status: 'success',
        success: true,
        kind: 'yolo11n',
        model: 'yolo11s',
        displayId: 'display-2',
        elapsedMs: 88,
        detections: [{
            classId: 32,
            className: 'sports ball',
            confidence: 0.876,
            left: 20,
            top: 30,
            right: 220,
            bottom: 260
        }]
    }, 'yolo');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /YOLO 检测结果/);
    assert.match(result.stdout, /yolo11s/);
    assert.match(result.stdout, /检测框.*1/);
    assert.match(result.stdout, /sports ball.*class#32/);
    assert.match(result.stdout, /0\.876/);
    assert.match(result.stdout, /20,30.*220,260/);
    assert.match(result.stdout, /位置图/);
});

test('视觉 TUI 将 API 错误以错误面板输出并返回失败状态', () => {
    const result = render({
        status: 'error',
        message: '没有支持 OCR 的显示端在线'
    }, 'ocr');

    assert.equal(result.status, 1);
    assert.match(result.stdout, /视觉请求失败/);
    assert.match(result.stdout, /没有支持 OCR 的显示端在线/);
});
