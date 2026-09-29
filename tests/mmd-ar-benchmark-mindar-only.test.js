'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('独立测试 APK 只打包 MindAR，不注入当前 JS 算法对比', () => {
    const build = read('3rd/mmd-ar-test/build.js');
    const assets = build.match(/const SOURCE_ASSET_FILES = Object\.freeze\(\[([\s\S]*?)\]\);/u)?.[1] || '';
    assert.ok(assets, 'APK 资源白名单应存在');
    assert.doesNotMatch(assets, /display-mmd-image-tracker\.js/u);
    assert.doesNotMatch(build, /<select id="mmdArTrackerEngine">/u);
    assert.match(build, /generatedPage\.includes\('<option value="current">'\)/u);
    assert.match(build, /<script>\s*window\.MmdArTestMindArOnly = true;/u);
    assert.match(build, /本测试只使用 MindAR/u);
});

test('独立测试定位适配器只运行和显示 MindAR 单算法指标', () => {
    const benchmark = read('3rd/mmd-ar-test/display-mmd-ar-benchmark.js');
    const controller = read('src/apps/web-mediacenter/ui/public/js/display-mmd-ar.js');
    assert.match(benchmark, /startMindArTracker\(target, options\)/u);
    assert.match(benchmark, /\['mindar'\]/u);
    assert.doesNotMatch(benchmark, /originalTracker|engine === 'current'|mmdArTrackerEngine|当前 JS/u);
    assert.match(controller, /function initializeCameraSettings\(\) \{\s*if \(!byId\('displayArTargetPlane'\)\) return;/u);
});
