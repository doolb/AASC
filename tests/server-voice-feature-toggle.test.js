'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('控制端声纹面板提供服务端 ASR/TTS 独立开关', () => {
    const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
    const panel = read('src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js');
    const websocket = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
    const voiceprintStart = upload.indexOf('<section class="panel" id="panel-voiceprint"');
    const voiceprintEnd = upload.indexOf('</section>', voiceprintStart);
    const voiceprintHtml = upload.slice(voiceprintStart, voiceprintEnd);

    assert.match(voiceprintHtml, /id="serverAsrEnabledCheck"/);
    assert.match(voiceprintHtml, /id="serverTtsEnabledCheck"/);
    assert.match(panel, /serverAsrEnabledCheck/);
    assert.match(panel, /serverTtsEnabledCheck/);
    assert.match(panel, /\/api\/config\/serverVoice/);
    assert.match(panel, /addEventListener\(['"]change['"],/);
    assert.match(websocket, /serverVoiceChanged/);
    assert.match(websocket, /VoiceprintPanel\.applyServerVoiceConfig/);
});

test('服务端语音开关默认开启并关闭时自动切换设备', () => {
    const config = read('src/apps/server/modules/config/config-app-service.js');
    const server = read('src/apps/server/boot/server-app.js');
    const tts = read('src/apps/web-mediacenter/ui/public/js/tts.js');

    assert.match(config, /serverEnabled:\s*true/);
    assert.match(server, /app\.get\(['"]\/api\/config\/serverVoice['"]/);
    assert.match(server, /app\.post\(['"]\/api\/config\/serverVoice['"]/);
    assert.match(server, /asr\.serverEnabled/);
    assert.match(server, /tts\.serverEnabled/);
    assert.match(server, /config\.set\(['"]asr\.device['"],\s*['"]display['"]\)/);
    assert.match(server, /config\.set\(['"]tts\.device['"],\s*['"]display['"]\)/);
    assert.match(tts, /serverEnabled/);
    assert.match(tts, /serverBtn\.disabled/);
});

test('服务端 ASR/TTS 关闭时不调用服务器引擎', () => {
    const server = read('src/apps/server/boot/server-app.js');
    const asrInitStart = server.indexOf('tts.init(config.getTtsConfig())');
    const asrInitEnd = server.indexOf('chat.init(', asrInitStart);
    const initBlock = server.slice(asrInitStart, asrInitEnd);
    const asrEndpointStart = server.indexOf("app.post('/api/asr/recognize'");
    const asrEndpointEnd = server.indexOf("app.get('/api/asr/status'", asrEndpointStart);
    const asrEndpoint = server.slice(asrEndpointStart, asrEndpointEnd);
    const ttsFunctionStart = server.indexOf('async function generateTtsWithFallback(');
    const ttsFunctionEnd = server.indexOf('// 裁剪调试日志开关', ttsFunctionStart);
    const ttsFunction = server.slice(ttsFunctionStart, ttsFunctionEnd);

    assert.match(initBlock, /config\.get\(['"]asr\.serverEnabled['"],\s*true\)/);
    assert.match(asrEndpoint, /isServerAsrEnabled\(\)/);
    assert.match(asrEndpoint, /服务器 ASR 已关闭/);
    assert.match(ttsFunction, /isServerTtsEnabled\(\)/);
    assert.match(ttsFunction, /服务器 TTS 已关闭/);
});
