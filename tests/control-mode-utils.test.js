'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const U = require('../src/apps/web-mediacenter/ui/public/js/control-mode-utils.js');

test('contentPointFromCropBox 裁剪框内百分比转内容百分比', () => {
    // 裁剪框：内容 20%,30% 起，宽 40%，高 50%
    const crop = { x: 20, y: 30, width: 40, height: 50 };
    // 框内 (0,0) = 内容左上角
    assert.deepStrictEqual(U.contentPointFromCropBox(crop, 0, 0), { x: 20, y: 30 });
    // 框内 (50,50) = 内容中心
    assert.deepStrictEqual(U.contentPointFromCropBox(crop, 50, 50), { x: 40, y: 55 });
    // 框内 (100,100) = 内容右下角
    assert.deepStrictEqual(U.contentPointFromCropBox(crop, 100, 100), { x: 60, y: 80 });
});

test('contentPixelFromPercent 内容百分比转像素', () => {
    // iframe 内容 1920x1080，内容坐标 (40%, 55%) → (768, 594)
    assert.deepStrictEqual(U.contentPixelFromPercent(1920, 1080, { x: 40, y: 55 }), { x: 768, y: 594 });
});

test('fitSizeTo720p 等比缩放不超过 720p', () => {
    assert.deepStrictEqual(U.fitSizeTo720p(1920, 1080), { width: 1280, height: 720 });
    // 竖屏
    assert.deepStrictEqual(U.fitSizeTo720p(1080, 1920), { width: 720, height: 1280 });
    // 小于 720p 不放大
    assert.deepStrictEqual(U.fitSizeTo720p(640, 480), { width: 640, height: 480 });
    // 恰好 720p
    assert.deepStrictEqual(U.fitSizeTo720p(1280, 720), { width: 1280, height: 720 });
});

test('clamp 限幅', () => {
    assert.strictEqual(U.clamp(150, 0, 100), 100);
    assert.strictEqual(U.clamp(-5, 0, 100), 0);
    assert.strictEqual(U.clamp(50, 0, 100), 50);
});
