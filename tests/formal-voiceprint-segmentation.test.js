'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('正式 APK 接入保护性声纹分段后处理并返回匹配分数', () => {
    const bridge = read('src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
    const engine = read('src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintEngine.kt');
    assert.match(bridge, /VoiceprintSegmentPostProcessor\.resolve/);
    assert.match(bridge, /similarityScore/);
    assert.match(bridge, /\.put\("threshold", VoiceprintEngine\.matchThreshold\)/);
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    assert.match(display, /result\.similarityScore = payload\.similarityScore/);
    assert.match(display, /result\.threshold = payload\.threshold/);
    assert.match(engine, /data class VoiceprintMatchResult/);
    assert.match(engine, /VoiceprintSimilarity\.cosine/);
    const server = read('src/apps/server/boot/server-app.js');
    assert.match(server, /similarityScore: segment\.similarityScore/);
    assert.match(server, /threshold: segment\.threshold/);
});

test('声纹阈值默认值为 0.3 并由控制端传入正式 APK', () => {
    const config = read('src/apps/server/modules/config/config-app-service.js');
    const server = read('src/apps/server/boot/server-app.js');
    const panel = read('src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js');
    const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    assert.match(config, /threshold: 0\.3/);
    assert.match(server, /config\.get\('voiceprint\.threshold', 0\.3\)/);
    assert.match(panel, /vpThresholdInput/);
    assert.match(panel, /threshold:/);
    assert.match(upload, /id="vpThresholdInput"/);
    assert.match(display, /threshold: data\.threshold \|\| 0\.3/);
});
