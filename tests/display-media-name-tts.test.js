'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('src/apps/server/boot/server-app.js', 'utf8');
const display = fs.readFileSync('src/apps/web-mediacenter/ui/public/display.html', 'utf8');

assert.match(display, /function requestMediaNameTts[\s\S]*?type: 'mediaNameTts'/u, '显示端应提供统一 TTS 请求函数');
const announceStart = display.indexOf('function announceAndReport');
const announceEnd = display.indexOf('// 视频自动播放', announceStart);
const announceBody = display.slice(announceStart, announceEnd);

assert.match(announceBody, /requestMediaNameTts\(displayName\)/u, '文件名播报应请求服务器统一 TTS');
assert.doesNotMatch(announceBody, /playTTS\(displayName\)/u, '文件名播报不得只在本地调用 playTTS');
assert.match(server, /displayTypes: \[[\s\S]*?'mediaNameTts'/u, '服务器应接收文件名 TTS 请求');
assert.match(
    server,
    /data\.type === 'mediaNameTts'[\s\S]*?generateTtsWithFallback\([\s\S]*?displayId[\s\S]*?sendToDisplay\(displayId, \{[\s\S]*?type: 'tts'[\s\S]*?action: 'playAudio'/u,
    '服务器应使用统一 TTS 生成并下发文件名音频'
);
assert.match(server, /prepareVoiceTtsPlayback\(displayId, data\)/u, '统一下发应创建跨设备播放状态');

console.log('display-media-name-tts.test.js: unified media name TTS contracts passed');
