'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DISPLAY = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/display.html');
const BRIDGE = path.join(ROOT, 'src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
const TTS_ENGINE = path.join(ROOT, 'src/apps/android-display/app/src/main/java/com/aasc/display/TtsEngine.kt');
const ASR_ENGINE = path.join(ROOT, 'src/apps/android-display/app/src/main/java/com/aasc/display/AsrEngine.kt');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

test('显示端消费 cpuConfig 不得同步阻塞 WebView，且应去重后调用异步桥', () => {
    const display = read(DISPLAY);
    const applyCpuConfig = display.match(/function applyCpuConfig\(config\) \{([\s\S]*?)\n\s*\}\n\n\s*\/\/ 截图降级链/);

    assert.ok(applyCpuConfig, '应存在 CPU 配置消费函数');
    assert.match(applyCpuConfig[1], /cpuConfigureAsync/);
    assert.match(applyCpuConfig[1], /JSON\.stringify/);
    assert.match(applyCpuConfig[1], /lastAppliedCpuConfigKey|pendingCpuConfigKey/);
    assert.doesNotMatch(applyCpuConfig[1], /nativeBridge\.cpuConfigure\s*\(/);
});

test('原生桥异步合并 CPU 配置，重复 policy 不重建 ASR/TTS pool', () => {
    const bridge = read(BRIDGE);
    const tts = read(TTS_ENGINE);
    const asr = read(ASR_ENGINE);

    assert.match(bridge, /fun cpuConfigureAsync\(/);
    assert.match(bridge, /cpuConfigExecutor/);
    assert.match(bridge, /cpuConfigPending/);
    assert.match(bridge, /ttsExecutorSlotCount/);
    assert.match(bridge, /if \(ttsExecutorSlotCount != slotCount\)/);
    assert.match(tts, /currentPolicy\s*==\s*policy[\s\S]*?return true/);
    assert.match(asr, /currentPolicy\s*==\s*policy[\s\S]*?return true/);
});

test('声纹模型回调必须切回 WebView 主线程', () => {
    const bridge = read(BRIDGE);
    const voiceprintConfigure = bridge.match(/fun voiceprintConfigure\(configJson: String\): String \{([\s\S]*?)\n\s*\}\n\n\s*\/\/ 单段声纹匹配/);

    assert.ok(voiceprintConfigure, '应存在声纹配置方法');
    assert.match(voiceprintConfigure[1], /mainHandler\.post/);
});
