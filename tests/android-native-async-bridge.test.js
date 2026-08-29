'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRIDGE = path.resolve(__dirname, '../src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const SERVER = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');

const read = (file) => fs.readFileSync(file, 'utf8');

test('原生桥提供 ASR/TTS 异步入口并通过主线程回调 JS', () => {
    const bridge = read(BRIDGE);

    assert.match(bridge, /fun asrRecognizeAsync\(/);
    assert.match(bridge, /fun ttsSynthesizeAsync\(/);
    assert.match(bridge, /mainHandler\.post/);
    assert.match(bridge, /onNativeAsrResult/);
    assert.match(bridge, /onNativeTtsResult/);
    assert.match(bridge, /ASR_TIMEOUT_SECONDS\s*=\s*60L/);
    assert.match(bridge, /TTS_TIMEOUT_SECONDS\s*=\s*60L/);
});

test('录音端使用公共路径，APK 提供端保留原生异步入口', () => {
    const display = read(DISPLAY);

    assert.match(display, /window\.onNativeTtsResult\s*=\s*function/);
    assert.match(display, /nativeBridge\.ttsSynthesizeAsync\(/);
    assert.match(display, /typeof nativeBridge\.ttsSynthesizeAsync/);
    assert.match(display, /fetch\('\/api\/asr\/recognize'/);
    assert.match(display, /nativeBridge\.asrRecognizeAsyncWithOptions\(/);
    assert.match(display, /window\.onNativeAsrResult\s*=\s*function/);

    const recordingStart = display.indexOf('async function startVoiceRecording()');
    const recordingEnd = display.indexOf('function startSilenceDetection()', recordingStart);
    assert.doesNotMatch(display.slice(recordingStart, recordingEnd), /nativeBridge\.asrRecognize|SherpaASR\./);

    const ttsCallback = display.match(/window\.onNativeTtsResult\s*=\s*function\(payload\)\s*\{([\s\S]*?)\n\s*\};/);
    assert.ok(ttsCallback, '应注册原生 TTS 完成回调');
    assert.doesNotMatch(ttsCallback[1], /ttsAudio\.play\s*\(/, 'TTS 生成回调不应直接播放音频');
});

test('服务端显示端模式按连接顺序转发 ASR，并保持 60 秒超时', () => {
    const server = read(SERVER);

    const uploadStart = server.indexOf("app.post('/api/asr/recognize'");
    const uploadEnd = server.indexOf("app.get('/api/config'", uploadStart);
    const upload = server.slice(uploadStart, uploadEnd);
    assert.match(upload, /const asrDevice = config\.get\('asr\.device', 'server'\)/);
    assert.match(upload, /findDisplayWithAsr\(\)/);
    assert.match(upload, /sendAudioToDisplayAsr\(displayWithAsr/);
    assert.match(server, /function findDisplayWithAsr\(\)[\s\S]*?for \(const \[displayId, displayData\] of displayClients\)/);
    assert.match(server, /function sendAudioToDisplayAsr[\s\S]*?const timeoutMs = 60000/);
    assert.match(server, /type:\s*['"]asrAudio['"]/);
    assert.doesNotMatch(server, /192\.168\.1\.6/);
});

test('TTS 原生桥在提交边界按 policy slotCount 有界并同步换代', () => {
    const bridge = read(BRIDGE);
    const dispatcher = read(path.resolve(__dirname, '../src/apps/android-display/app/src/main/java/com/aasc/display/TtsBridgeDispatcher.kt'));

    assert.match(bridge, /private val ttsExecutor = TtsBridgeDispatcher\(TtsEngine\.currentPolicySlotCount\(\)\)/);
    assert.match(bridge, /val slotCount = maxOf\(1, ttsPolicy\.totalCoreCount\)/);
    assert.match(bridge, /if \(ttsExecutorSlotCount != slotCount\)/);
    assert.match(bridge, /ttsExecutor\.reconfigure\(slotCount\)/);
    assert.match(bridge, /synchronized\(ttsExecutorLock\)/);
    assert.match(bridge, /JSONObject\(\)\.put\("accepted", false\)/);
    assert.match(dispatcher, /ArrayBlockingQueue\(queueCapacity\)/);
    assert.match(dispatcher, /workerCount,\s*\n\s*workerCount,/);
    assert.match(dispatcher, /retired\.shutdown\(\)/);
    assert.doesNotMatch(bridge, /private val ttsExecutor = Executors\.newCachedThreadPool\(\)/);
});
