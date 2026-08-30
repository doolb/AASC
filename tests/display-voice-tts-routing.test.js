'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');
const VOICE_COMMAND = path.resolve(
    __dirname,
    '../src/apps/web-mediacenter/modules/voice/voice-command-app-service.js'
);

const read = file => fs.readFileSync(file, 'utf8');
const server = read(SERVER);
const voiceCommand = read(VOICE_COMMAND);

assert.match(
    server,
    /async function sendVoiceInputTts\(text(?:, originDisplayId = null)?\)[\s\S]*?generateTtsWithFallback\(text[\s\S]*?getOnlineVoicePlaybackDisplayIds\(\)/,
    '显示端语音 TTS 应通过服务端通用生成和语音播放目标列表，必要时支持来源显示端'
);
assert.match(
    server,
    /onTts: isDisplayVoiceInput[\s\S]*?sendVoiceInputTts\(text(?:, targetDisplayId)?\)/,
    '显示端语音输入应注入通用 TTS 回调，控制端播放回调保持独立'
);
assert.match(
    voiceCommand,
    /callbacks\.onTts/,
    '语音命令服务应支持调用方注入 TTS 路由'
);
assert.doesNotMatch(
    voiceCommand,
    /tts\.generateTTS\(/,
    '语音命令服务不应绕过服务端通用 TTS 路由'
);
assert.match(
    voiceCommand,
    /processVoiceCommand\(action, displayId, callbacks, true\)/,
    '组合内置命令应保留显示端语音 TTS 回调'
);

console.log('display-voice-tts-routing.test.js: contract checks passed');
