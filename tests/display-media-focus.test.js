'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const NATIVE_BRIDGE = path.resolve(__dirname, '../src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
const AUDIO_FOCUS = path.resolve(__dirname, '../src/apps/android-display/app/src/main/java/com/aasc/display/AudioFocusController.kt');

test('显示端检测非预期媒体暂停并按期望播放状态恢复', () => {
    const source = fs.readFileSync(DISPLAY, 'utf8');
    assert.match(source, /function installMediaPlaybackStateMonitor\(\)/);
    assert.match(source, /addEventListener\('pause'/);
    assert.match(source, /function recoverUnexpectedMediaPause\(\)/);
    assert.match(source, /mediaIsPlaying && !pauseExpected/);
    assert.match(source, /playStateReport/);
});

test('显示端接收 APK 音频焦点恢复通知', () => {
    const source = fs.readFileSync(DISPLAY, 'utf8');
    assert.match(source, /onNativeAudioFocusChanged/);
    assert.match(source, /recoverUnexpectedMediaPause\(.*audioFocus/s);
});

test('APK 注册 AudioFocus 并把焦点变化通知 WebView', () => {
    const bridge = fs.readFileSync(NATIVE_BRIDGE, 'utf8');
    const source = fs.readFileSync(AUDIO_FOCUS, 'utf8');
    assert.match(source, /AudioManager/);
    assert.match(source, /OnAudioFocusChangeListener/);
    assert.match(source, /requestAudioFocus/);
    assert.match(bridge, /requestAudioFocus/);
    assert.match(bridge, /onNativeAudioFocusChanged/);
});
