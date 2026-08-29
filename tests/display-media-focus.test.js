'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const TEXT_PLAYER = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/text-media-player.js');
const MAIN_ACTIVITY = path.resolve(__dirname, '../src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt');
const NATIVE_BRIDGE = path.resolve(__dirname, '../src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
const AUDIO_FOCUS = path.resolve(__dirname, '../src/apps/android-display/app/src/main/java/com/aasc/display/AudioFocusController.kt');

test('显示端仍按网页期望播放状态恢复非预期媒体暂停', () => {
    const source = fs.readFileSync(DISPLAY, 'utf8');
    assert.match(source, /function installMediaPlaybackStateMonitor\(\)/);
    assert.match(source, /addEventListener\('pause'/);
    assert.match(source, /function recoverUnexpectedMediaPause\(\)/);
    assert.match(source, /mediaIsPlaying && !pauseExpected/);
    assert.match(source, /media\.ended/);
    assert.match(source, /playStateReport/);
    assert.doesNotMatch(source, /mediaAudioFocusInterrupted/);
});

test('APK Kotlin 恢复 Git 基线的原生音频焦点桥接', () => {
    const activity = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
    const bridge = fs.readFileSync(NATIVE_BRIDGE, 'utf8');
    const source = fs.readFileSync(AUDIO_FOCUS, 'utf8');
    assert.equal(fs.existsSync(AUDIO_FOCUS), true);
    assert.match(source, /AudioManager/);
    assert.match(source, /OnAudioFocusChangeListener/);
    assert.match(source, /requestAudioFocus/);
    assert.match(bridge, /audioFocusController/);
    assert.match(bridge, /fun requestAudioFocus\(\)/);
    assert.match(bridge, /fun abandonAudioFocus\(\)/);
    assert.match(activity, /AudioFocusController/);
    assert.match(activity, /audioFocusController\.request\(\)/);
    assert.match(activity, /NativeBridge\(wv, audioFocusController\)/);
});

test('网页媒体不调用 Android 原生音频焦点接口', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');
    assert.doesNotMatch(display, /requestNativeAudioFocus|abandonNativeAudioFocus|requestWebAudioFocus/);
    assert.doesNotMatch(display, /hasNativeWebAudioFocus/);
    assert.doesNotMatch(display, /requestAudioFocus\s*:/);
});

test('网页 TTS 继续使用自身音频元素播放并保持 100% 音量', () => {
    const source = fs.readFileSync(DISPLAY, 'utf8');
    assert.match(source, /function playTTS\(/);
    assert.match(source, /ttsAudio\.play\(\)/);
    assert.match(source, /ttsAudio\.volume\s*=\s*1/);
    assert.doesNotMatch(source, /NativeDisplay\.(requestAudioFocus|abandonAudioFocus)/);
});

test('文本媒体播放器不接入原生焦点回调', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');
    const player = fs.readFileSync(TEXT_PLAYER, 'utf8');
    assert.doesNotMatch(display, /requestAudioFocus\s*:/);
    assert.match(player, /function recoverAudioPlayback\(/);
    assert.doesNotMatch(player, /options\.requestAudioFocus/);
    assert.match(player, /audio\.volume\s*=\s*1/);
});

test('TTS 通过网页媒体事件自动恢复且不重新申请原生焦点', () => {
    const source = fs.readFileSync(DISPLAY, 'utf8');
    assert.match(source, /ttsRecoveryTimer/);
    assert.match(source, /scheduleTtsRecovery/);
    assert.match(source, /\['pause', 'stalled', 'waiting'\]/);
    assert.match(source, /onNativeAudioFocusChanged[\s\S]*?recoverTtsPlayback/);
    assert.doesNotMatch(source, /requestNativeAudioFocus|requestWebAudioFocus/);
    assert.match(source, /function stopTtsPlayback\(\)/);
    assert.match(source, /currentTtsItem\s*=\s*null/);
});

test('TTS 开始和结束不修改视频声音', () => {
    const source = fs.readFileSync(DISPLAY, 'utf8');
    const end = source.slice(source.indexOf('function endTtsVideoCoordination'), source.indexOf('function endTtsVideoCoordinationIfIdle'));
    assert.doesNotMatch(end, /mediaVideo\.(muted|volume)\s*=/);
    assert.doesNotMatch(end, /playVideoAuto\(mediaVideo,\s*true\)/);
    assert.match(source, /ttsAudio\.volume\s*=\s*1/);
});

test('网页仍不主动调用原生音频焦点协议', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');
    assert.doesNotMatch(display, /NativeDisplay\.(requestAudioFocus|abandonAudioFocus)/);
    assert.doesNotMatch(display, /requestNativeAudioFocus|abandonNativeAudioFocus|requestWebAudioFocus/);
    assert.match(display, /window\.onNativeAudioFocusChanged/);
});
