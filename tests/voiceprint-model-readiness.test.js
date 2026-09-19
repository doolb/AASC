'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('显示端区分声纹引擎 ready 和声纹库 ready', () => {
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    assert.match(display, /let voiceprintEngineReady = false/u);
    assert.match(display, /let voiceprintDbReady = false/u);
    assert.match(display, /voiceprintReady = voiceprintEnabled && voiceprintEngineReady && voiceprintDbReady/u);
    assert.match(display, /function waitForVoiceprintEngineReady\(\)/u);
});

test('声纹注册提取必须等待引擎 ready 并具有 60 秒上限', () => {
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    const extractStart = display.indexOf('async function handleVoiceprintExtract(');
    const extractEnd = display.indexOf('        let localAsrStreaming', extractStart);
    assert.ok(extractStart >= 0, '应存在声纹提取等待函数');
    assert.match(display.slice(extractStart, extractEnd + 9), /await waitForVoiceprintEngineReady\(\)/u);
    assert.match(display, /const VOICEPRINT_READY_TIMEOUT_MS = 60000/u);
    assert.match(display, /void handleVoiceprintExtract\(data, socket\)/u);
});

test('服务端声纹注册等待时间与显示端等待时间一致', () => {
    const server = read('src/apps/server/boot/server-app.js');
    const registerStart = server.indexOf("app.post('/api/voiceprint/register'");
    const registerEnd = server.indexOf('function getAsrRequestContext', registerStart);
    const registerBody = server.slice(registerStart, registerEnd);
    assert.match(registerBody, /显示端声纹提取超时/u);
    assert.match(registerBody, /\}, 60000\)/u);
    assert.match(registerBody, /displayId: display\.id/u);
});

test('显示端断开时会立即回收声纹注册等待', () => {
    const server = read('src/apps/server/boot/server-app.js');
    const closeStart = server.indexOf("ws.on('close', () => {");
    const closeEnd = server.indexOf("} else if (url === '/control'", closeStart);
    const closeBody = server.slice(closeStart, closeEnd);
    assert.match(closeBody, /for \(const \[requestId, pending\] of pendingVoiceprintExtracts\)/u);
    assert.match(closeBody, /显示端已离线，声纹提取失败/u);
});

test('声纹配置关闭时会拒绝等待中的注册请求', () => {
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    const configStart = display.indexOf("if (data.type === 'voiceprintConfig')");
    const configEnd = display.indexOf("if (data.type === 'speakerDbUpdated')", configStart);
    const configBody = display.slice(configStart, configEnd);
    assert.match(configBody, /rejectVoiceprintReadyWaiters\('声纹功能未启用'\)/u);
});

test('ASR 与声纹均在显示端初始化配置阶段触发预热', () => {
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    const asrStart = display.indexOf("if (data.type === 'asrConfig')");
    const asrEnd = display.indexOf("if (data.type === 'ttsConfig')", asrStart);
    const voiceprintStart = display.indexOf("if (data.type === 'voiceprintConfig')");
    const voiceprintEnd = display.indexOf("if (data.type === 'speakerDbUpdated')", voiceprintStart);
    assert.match(display.slice(asrStart, asrEnd), /nativeBridge\.asrEnsureModel\(\)/u);
    assert.match(display.slice(voiceprintStart, voiceprintEnd), /nativeBridge\.voiceprintConfigure\(/u);
});
