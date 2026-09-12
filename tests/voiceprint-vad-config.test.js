'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_SERVICE = path.resolve(__dirname, '../src/apps/server/modules/config/config-app-service.js');
const SERVER = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');
const UPLOAD = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/upload.html');
const PANEL = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js');
const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const NODE_DISPLAY = path.resolve(__dirname, '../src/apps/voice-display-node/main.js');

const read = file => fs.readFileSync(file, 'utf8');
const configService = read(CONFIG_SERVICE);
const server = read(SERVER);
const upload = read(UPLOAD);
const panel = read(PANEL);
const display = read(DISPLAY);
const nodeDisplay = read(NODE_DISPLAY);

assert.match(configService, /vadSilenceDurationMs:\s*500/, '服务器 voiceprint 默认配置应包含 500ms 静音时长');
assert.match(configService, /vadMinSpeechDurationMs:\s*300/, '服务器 voiceprint 默认配置应包含 300ms 最短语音时长');

assert.match(server, /voiceprint\.vadSilenceDurationMs/, '服务器应读写全局 VAD 静音时长');
assert.match(server, /voiceprint\.vadMinSpeechDurationMs/, '服务器应读写全局 VAD 最短语音时长');
assert.match(server, /type:\s*'voiceprintConfig'[\s\S]*vadSilenceDurationMs/, 'voiceprintConfig 广播应包含全局 VAD 静音时长');
assert.match(server, /type:\s*'voiceprintConfig'[\s\S]*vadMinSpeechDurationMs/, 'voiceprintConfig 广播应包含全局 VAD 最短语音时长');
assert.match(server, /normalizeVadDuration/, '服务器应限制全局 VAD 时长在安全范围内');

assert.match(upload, /id="vpVadSilenceDurationInput"[^>]*min="100"[^>]*max="5000"[^>]*value="500"/, '声纹面板应提供 500ms 静音时长输入');
assert.match(upload, /id="vpVadMinSpeechDurationInput"[^>]*min="100"[^>]*max="5000"[^>]*value="300"/, '声纹面板应提供 300ms 最短语音输入');
assert.match(upload, /VAD 静音|静音时长/, '声纹面板应说明 VAD 静音时长');
assert.match(upload, /VAD 最短语音|最短语音时长/, '声纹面板应说明 VAD 最短语音时长');

assert.match(panel, /vpVadSilenceDurationInput/, '声纹面板脚本应加载和保存静音时长');
assert.match(panel, /vpVadMinSpeechDurationInput/, '声纹面板脚本应加载和保存最短语音时长');
assert.match(panel, /vadSilenceDurationMs/, '声纹面板脚本应提交全局 VAD 静音时长');
assert.match(panel, /vadMinSpeechDurationMs/, '声纹面板脚本应提交全局 VAD 最短语音时长');

const webVoiceprintStart = display.indexOf("if (data.type === 'voiceprintConfig')");
const webVoiceprintEnd = display.indexOf("if (data.type === 'speakerDbUpdated')", webVoiceprintStart);
assert.ok(webVoiceprintStart >= 0 && webVoiceprintEnd > webVoiceprintStart, '网页显示端应存在 voiceprintConfig 处理分支');
const webVoiceprintHandler = display.slice(webVoiceprintStart, webVoiceprintEnd);
assert.match(webVoiceprintHandler, /vadSilenceDurationMs/, '网页显示端应应用 voiceprintConfig 的静音时长');
assert.match(webVoiceprintHandler, /vadMinSpeechDurationMs/, '网页显示端应应用 voiceprintConfig 的最短语音时长');

const nodeVoiceprintStart = nodeDisplay.indexOf('handleVoiceprintConfig(data)');
const nodeVoiceprintEnd = nodeDisplay.indexOf('handleVoiceVadConfig(data)', nodeVoiceprintStart);
assert.ok(nodeVoiceprintStart >= 0 && nodeVoiceprintEnd > nodeVoiceprintStart, 'Node 子显示端应存在 voiceprintConfig 处理函数');
const nodeVoiceprintHandler = nodeDisplay.slice(nodeVoiceprintStart, nodeVoiceprintEnd);
assert.match(nodeVoiceprintHandler, /vadSilenceDurationMs/, 'Node 子显示端应应用 voiceprintConfig 的静音时长');
assert.match(nodeVoiceprintHandler, /vadMinSpeechDurationMs/, 'Node 子显示端应应用 voiceprintConfig 的最短语音时长');
assert.match(nodeVoiceprintHandler, /applyVadConfig/, 'Node 子显示端应复用现有 VAD 配置入口');

console.log('voiceprint-vad-config.test.js: contract checks passed');
