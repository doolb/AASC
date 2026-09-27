'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const read = (relativePath) => fs.readFileSync(path.join(PUBLIC, relativePath), 'utf8');

test('正式显示端提供 MindAR 默认入口、旧 JS 回退和相机/物理控件', () => {
    const html = read('display.html');
    assert.match(html, /id="displayArAframeHost"[^>]*hidden/u);
    assert.match(html, /id="displayArTrackerEngine"[\s\S]*?<option value="mindar"[\s\S]*?<option value="legacy"/u);
    for (const id of [
        'displayArTargetPlane', 'displayArTranslationDeadZone', 'displayArRotationDeadZone',
        'displayArSmoothing', 'displayArCameraDistance',
        'displayMmdMotionPlayback', 'displayMmdPhysicsEnabled'
    ]) assert.match(html, new RegExp(`id="${id}"`, 'u'));
    assert.match(html, /src="js\/display-mmd-ar-mindar\.js" defer/u);
    assert.match(html, /src="js\/display-mmd-image-tracker\.js" defer/u);
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
    assert.match(controller, /root\.DisplayMmdImageTargetTracker/u);
    assert.match(adapter, /root\.DisplayMmd\?\.suspendArCameraPose\?\.\(\)/u);
    assert.match(adapter, /system\.video\?\.srcObject\?\.getTracks/u);
});
