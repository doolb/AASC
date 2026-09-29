'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const read = (relativePath) => fs.readFileSync(path.join(PUBLIC, relativePath), 'utf8');

test('正式显示端固定 MindAR，移除旧 JS 算法入口', () => {
    const html = read('display.html');
    const controller = read('js/display-mmd-ar.js');
    assert.match(html, /id="displayArAframeHost"[^>]*hidden/u);
    assert.match(html, /<output id="displayArTrackerEngine">MindAR<\/output>/u);
    assert.doesNotMatch(html, /<select id="displayArTrackerEngine"/u);
    assert.doesNotMatch(html, /<option value="legacy"/u);
    assert.match(html, /DisplayMmdProductionMindArOnly = true/u);
    for (const id of [
        'displayArTargetPlane', 'displayArTranslationDeadZone', 'displayArRotationDeadZone',
        'displayArSmoothing', 'displayArCameraDistance',
        'displayMmdMotionPlayback', 'displayMmdPhysicsEnabled'
    ]) assert.match(html, new RegExp(`id="${id}"`, 'u'));
    assert.match(html, /src="js\/display-mmd-ar-mindar\.js" defer/u);
    assert.doesNotMatch(html, /src="js\/display-mmd-image-tracker\.js"/u);
    assert.doesNotMatch(controller, /ENGINE_KEY|function readEngine\(|legacy/u);
    assert.match(controller, /root\.DisplayMmdProductionMindArOnly/u);
});

test('正式 MindAR 在用户开始定位后才加载同源 A-Frame/MindAR', () => {
    const adapter = read('js/display-mmd-ar-mindar.js');
    const controller = read('js/display-mmd-ar.js');
    assert.match(adapter, /async function load\(\)/u);
    assert.match(adapter, /vendor\/aframe-1\.5\.0\/aframe\.min\.js/u);
    assert.match(adapter, /vendor\/mind-ar-1\.2\.5\/mindar-image-aframe\.prod\.js/u);
    assert.match(adapter, /compileImageTargets\(\[rectified\.canvas\], \(\) => \{\}\)/u);
    assert.doesNotMatch(adapter, /https?:\/\//u);
    assert.match(controller, /if \(aframe\) await tracker\.load\?\.\(\)/u);
    assert.match(controller, /root\.DisplayMmdMindArTracker/u);
    assert.match(adapter, /root\.DisplayMmd\?\.suspendArCameraPose\?\.\(\)/u);
    assert.match(adapter, /system\.video\?\.srcObject\?\.getTracks/u);
});
