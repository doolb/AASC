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
    /async function sendVoiceInputTts\(text(?:, playbackOptions = \{\})?\)[\s\S]*?generateTtsWithFallback\(\s*text[\s\S]*?resolveCurrentVoicePlaybackTarget\(/,
    '显示端语音 TTS 应通过服务端通用生成和来源优先的唯一播放目标'
);
assert.match(
    server,
    /onTts: isDisplayVoiceInput[\s\S]*?sendVoiceInputTts\(text,\s*\{[\s\S]*?preferredDisplayId:\s*targetDisplayId/,
    '显示端语音输入应注入来源端优先的单目标 TTS 回调，控制端播放回调保持独立'
);
assert.match(
    server,
    /resolveCurrentVoicePlaybackTarget\(preferredDisplayId\)/,
    '语音输入 TTS 应按来源端优先、在线能力兜底动态选择唯一播放目标'
);
assert.match(
    server,
    /voiceConversationDisplayId:\s*voiceOriginDisplayId\s*\|\|\s*displayId/u,
    '语音聊天回复 TTS 应关联原始会话显示端，避免备用播放端暂停错倒计时'
);
assert.match(
    server,
    /rememberVoicePlaybackTarget\(preferredDisplayId, targetDisplayId\)/,
    '语音输入 TTS 应记录实际播放目标供停止命令使用'
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
