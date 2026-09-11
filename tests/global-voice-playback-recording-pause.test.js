'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('声纹面板提供全局播放时暂停录音开关并保存布尔值', () => {
    const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
    const panel = read('src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js');
    const voiceprintStart = upload.indexOf('<section class="panel" id="panel-voiceprint"');
    const voiceprintEnd = upload.indexOf('</section>', voiceprintStart);
    const voiceprintHtml = upload.slice(voiceprintStart, voiceprintEnd);

    assert.match(voiceprintHtml, /id="vpPauseRecordingDuringPlaybackCheck"/);
    assert.match(voiceprintHtml, /播放时暂停录音/);
    assert.match(panel, /vpPauseRecordingDuringPlaybackCheck/);
    assert.match(panel, /pauseRecordingDuringPlayback !== false/);
    assert.match(panel, /pauseRecordingDuringPlayback:\s*document\.getElementById\('vpPauseRecordingDuringPlaybackCheck'\)\.checked/);
});

test('服务端保存全局播放时暂停录音配置并广播到所有显示端', () => {
    const config = read('src/apps/server/modules/config/config-app-service.js');
    const server = read('src/apps/server/boot/server-app.js');
    const getConfigStart = server.indexOf("app.get('/api/voiceprint/config'");
    const getConfigEnd = server.indexOf("app.post('/api/voiceprint/config'", getConfigStart);
    const getConfig = server.slice(getConfigStart, getConfigEnd);
    const postConfigStart = getConfigEnd;
    const postConfigEnd = server.indexOf('// 修复模式配置', postConfigStart);
    const postConfig = server.slice(postConfigStart, postConfigEnd);
    const displayConnectStart = server.indexOf("type: 'voiceprintConfig'", server.indexOf("if (url === '/display'"));
    const displayConnectEnd = server.indexOf("// 显示端已连接", displayConnectStart);
    const displayConnect = server.slice(displayConnectStart, displayConnectEnd);

    assert.match(config, /pauseRecordingDuringPlayback:\s*true/);
    assert.match(getConfig, /pauseRecordingDuringPlayback:\s*config\.get\('voiceprint\.pauseRecordingDuringPlayback',\s*true\)/);
    assert.match(postConfig, /pauseRecordingDuringPlayback/);
    assert.match(postConfig, /typeof pauseRecordingDuringPlayback !== 'boolean'/);
    assert.match(postConfig, /config\.set\('voiceprint\.pauseRecordingDuringPlayback',\s*pauseRecordingDuringPlayback\)/);
    assert.match(postConfig, /type: 'voiceprintConfig'/);
    assert.match(postConfig, /pauseRecordingDuringPlayback:\s*config\.get\('voiceprint\.pauseRecordingDuringPlayback',\s*true\)/);
    assert.match(displayConnect, /pauseRecordingDuringPlayback:\s*config\.get\('voiceprint\.pauseRecordingDuringPlayback',\s*true\)/);
});

test('显示端默认暂停播放时录音，并允许全局 false 关闭暂停', () => {
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    const configHandlerStart = display.indexOf("if (data.type === 'voiceprintConfig')");
    const configHandlerEnd = display.indexOf("if (data.type === 'voiceVadConfig')", configHandlerStart);
    const configHandler = display.slice(configHandlerStart, configHandlerEnd);
    const pauseStart = display.indexOf('function pauseVoiceRecordingForTts()');
    const pauseEnd = display.indexOf('// TTS 队列结束后恢复', pauseStart);
    const pauseHandler = display.slice(pauseStart, pauseEnd);

    assert.match(display, /let\s+pauseRecordingDuringPlayback\s*=\s*true/);
    assert.match(configHandler, /pauseRecordingDuringPlayback\s*=\s*data\.pauseRecordingDuringPlayback !== false/);
    assert.match(pauseHandler, /pauseRecordingDuringPlayback\s*===\s*false/);
    assert.doesNotMatch(pauseHandler, /voiceprintEnabled\s*===\s*true/);
});
