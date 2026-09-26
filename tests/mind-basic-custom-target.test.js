'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const geometry = require('../3rd/mind-basic/mind-basic-geometry.js');

const root = path.join(__dirname, '..', '3rd', 'mind-basic');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'mind-basic.js'), 'utf8');

test('Mind Basic 保留官方目标和 Softmind，并由页面控制 MindAR 启停', () => {
  assert.match(html, /autoStart:\s*false/u);
  assert.match(html, /card\.mind/u);
  assert.match(html, /softmind\/scene\.gltf/u);
  assert.match(html, /mindar-image-target="targetIndex:\s*0"/u);
  assert.match(html, /mind-basic-geometry\.js/u);
  assert.match(html, /mind-basic\.js/u);
});

test('自定义目标拍照后提供可移动、可缩放的矩形裁剪编辑器', () => {
  assert.match(html, /mindBasicCropFrame/u);
  assert.doesNotMatch(html, /mindBasicCropPreview/u);
  assert.match(html, /data-crop-handle="nw"/u);
  assert.match(html, /data-crop-handle="e"/u);
  assert.match(html, /mindBasicRetakeButton/u);
  assert.match(html, /四边内缩 10%/u);
  assert.ok(script.includes('DEFAULT_CROP_RECT = Object.freeze({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })'));
  assert.match(script, /pointerdown/u);
  assert.match(script, /moveCropRect/u);
  assert.match(script, /resizeCropRect/u);
  assert.doesNotMatch(script, /homography|透视校正/u);
});

test('上方面板初始展开并可切换折叠状态', () => {
  assert.match(html, /mindBasicControlsToggle[\s\S]*aria-expanded="true"/u);
  assert.match(html, /mindBasicControlsBody/u);
  assert.match(script, /controlsExpanded:\s*true/u);
  assert.match(script, /setControlsExpanded\(!state\.controlsExpanded\)/u);
});

test('自定义目标在本地保存矩形、编译并切换 MindAR 资源', () => {
  assert.match(script, /getUserMedia\(/u);
  assert.match(script, /indexedDB\.open\(DATABASE_NAME/u);
  assert.match(script, /DEFAULT_CROP_RECT/u);
  assert.match(script, /cropRect:\s*\{ \.\.\.state\.cropRect \}/u);
  assert.match(script, /getPixelCropBounds/u);
  assert.match(script, /compileImageTargets\(\[rectifiedCanvas\]/u);
  assert.match(script, /exportData\(\)/u);
  assert.match(script, /state\.system\.imageTargetSrc\s*=\s*targetSrc/u);
  assert.match(script, /URL\.revokeObjectURL/u);
  assert.match(script, /removeEventListener\('resize', state\.resizeHandler\)/u);
  assert.match(script, /pageshow/u);
  assert.doesNotMatch(script, /fetch\([^\n]*\b(?:POST|PUT)\b/iu);
});

test('矩形选区合法性和像素裁剪边界正确', () => {
  const fixedRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  assert.equal(geometry.isValidCropRect(fixedRect), true);
  assert.equal(geometry.isValidCropRect({ x: -0.1, y: 0.1, width: 0.8, height: 0.8 }), false);
  assert.equal(geometry.isValidCropRect({ x: 0.1, y: 0.1, width: 0.95, height: 0.8 }), false);
  assert.equal(geometry.isValidCropRect({ x: 0.1, y: 0.1, width: 0.001, height: 0.001 }), true);
  assert.equal(geometry.isValidCropRect({ x: 0.1, y: 0.1, width: 0, height: 0.1 }), false);
  assert.deepEqual(geometry.getPixelCropBounds(1000, 500, fixedRect), {
    x: 100, y: 50, width: 800, height: 400
  });
});

test('矩形框可在图片边界内移动并调整边角尺寸', () => {
  const initial = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  const assertRectClose = (actual, expected) => {
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(actual[key] - expected[key]) < 1e-12, `${key}: ${actual[key]}`);
    }
  };
  assertRectClose(geometry.moveCropRect(initial, 0.2, 0.1), {
    x: 0.2, y: 0.2, width: 0.8, height: 0.8
  });
  assertRectClose(geometry.moveCropRect(initial, -0.5, 0.5), {
    x: 0, y: 0.2, width: 0.8, height: 0.8
  });
  assertRectClose(geometry.resizeCropRect(initial, 'se', -0.1, -0.1), {
    x: 0.1, y: 0.1, width: 0.7, height: 0.7
  });
  assertRectClose(geometry.resizeCropRect(initial, 'nw', 0.1, 0.05), {
    x: 0.2, y: 0.15, width: 0.7, height: 0.75
  });
  assertRectClose(geometry.resizeCropRect(initial, 'e', 0.5, 0), {
    x: 0.1, y: 0.1, width: 0.9, height: 0.8
  });
  assert.equal(geometry.resizeCropRect(initial, 'unknown', 0.1, 0.1), null);
});

test('旧版四角选区按轴对齐外接矩形兼容读取', () => {
  const selectedQuad = [
    { x: 0.12, y: 0.16 }, { x: 0.88, y: 0.1 },
    { x: 0.82, y: 0.86 }, { x: 0.18, y: 0.9 }
  ];
  assert.deepEqual(geometry.cropRectFromLegacyQuad(selectedQuad), {
    x: 0.12, y: 0.1, width: 0.76, height: 0.8
  });
  assert.deepEqual(geometry.getCropRect({ selectedQuad }), {
    x: 0.12, y: 0.1, width: 0.76, height: 0.8
  });
});
