'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');
const TASK_MANAGER = path.resolve(__dirname, '../src/apps/server/modules/task-engine/task-manager.js');
const TIME_ANNOUNCE = path.resolve(__dirname, '../src/apps/server/modules/task-engine/builtin-tasks/time-announce.js');

const read = (file) => fs.readFileSync(file, 'utf8');

test('服务端普通 TTS 入口统一经过显示端 fallback 路由', () => {
    const server = read(SERVER);
    const directCalls = server.match(/tts\.generateTTS\(/g) || [];

    // 只允许 generateTtsWithFallback 内部在最终回退分支调用底层服务器 TTS。
    assert.equal(directCalls.length, 1);
    assert.match(server, /sendVoiceCommandTts\(helpTTS, targetDisplayId\)/);
    assert.match(server, /sendVoiceCommandTts\(modeText, targetDisplayId\)/);
    assert.match(server, /今日提醒：\$\{text\}.*generateTtsWithFallback/s);
});

test('显示端 TTS 必须先回报开始生成，服务端 3 秒未收到即失败', () => {
    const server = read(SERVER);
    const display = read(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html'));

    assert.match(server, /ttsGenerating/);
    assert.match(server, /startTimer/);
    assert.match(server, /3000/);
    assert.match(server, /pending\.started/);
    assert.match(display, /function sendTtsGenerating\(requestId\)/);
    assert.match(display, /sendTtsGenerating\(data\.requestId\)/);
});

test('整点报时任务使用服务端注入的 TTS 路由', () => {
    const taskManager = read(TASK_MANAGER);
    const timeAnnounce = read(TIME_ANNOUNCE);

    assert.match(taskManager, /setGenerateTts\(fn\)/);
    assert.match(taskManager, /generateTTS:\s*this\._generateTts/);
    assert.match(timeAnnounce, /broadcastToDisplays, generateTTS/);
    assert.doesNotMatch(timeAnnounce, /tts\.generateTTS\(/);
});
