'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');
const WEBSOCKET = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/websocket.js');
const CHAT = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/chat.js');
const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');

const read = file => fs.readFileSync(file, 'utf8');
const server = read(SERVER);
const websocket = read(WEBSOCKET);
const chat = read(CHAT);
const display = read(DISPLAY);
const start = server.indexOf('async function handleChatMessage(options)');
const end = server.indexOf('\nconst deviceEventDebounce', start);
assert.ok(start >= 0 && end > start, '应能定位普通聊天处理函数');
const handler = server.slice(start, end);

assert.match(
    handler,
    /voiceOriginDisplayId/,
    '普通聊天处理需要接收语音来源显示端'
);
assert.match(
    handler,
    /type:\s*'chatInput'[\s\S]{0,240}requestId/,
    '普通聊天流开始前应向控制端发送即时输入事件'
);
assert.match(
    handler,
    /type:\s*'voiceCommand'[\s\S]{0,260}detailText:\s*fullMessage/,
    '语音普通聊天完成后应向来源显示端发送完整 detailText'
);
const sentenceStart = handler.indexOf('onSentence:');
const completeStart = handler.indexOf('onComplete:', sentenceStart);
assert.ok(sentenceStart >= 0 && completeStart > sentenceStart, '应能定位聊天 TTS 和完成回调');
const sentenceHandler = handler.slice(sentenceStart, completeStart);
assert.match(sentenceHandler, /routeVoiceToAll/);
assert.doesNotMatch(
    sentenceHandler,
    /sendToDisplay\(voiceOriginDisplayId/,
    '语音普通聊天 TTS 不应定向回来源显示端'
);
assert.match(
    server,
    /voiceOriginDisplayId:\s*isDisplayVoiceInput\s*\?\s*targetDisplayId\s*:\s*null/,
    '显示端语音进入聊天路径时应传递来源显示端'
);
assert.match(
    server,
    /const sendToControl = isDisplayVoiceInput\s*\n\s*\? \(msg\) => broadcastToControls\(msg\)/,
    '显示端语音普通聊天回包应广播到控制端'
);
assert.match(
    server,
    /onTts: isDisplayVoiceInput[\s\S]{0,100}sendVoiceInputTts\(text\)/,
    '显示端语音命令 TTS 应继续使用原有通用路由'
);
assert.match(websocket, /data\.type === 'chatInput'[\s\S]{0,180}handleDisplayChatInput/);
const chatInputStart = chat.indexOf('handleDisplayChatInput(data)');
const chatInputEnd = chat.indexOf('\n    },', chatInputStart);
assert.ok(chatInputStart >= 0 && chatInputEnd > chatInputStart, '控制端应提供显示端语音聊天输入处理方法');
assert.match(chat.slice(chatInputStart, chatInputEnd), /showStreamingMessage/);
assert.match(
    display,
    /const detailText = data\.detailText \|\| data\.text[\s\S]{0,140}showVoiceResponsePopup\(detailText, calculateWeatherPopupDuration\(detailText\)\)/,
    '来源显示端普通语音回复应按文字长度显示 detailText 弹窗'
);

console.log('display-voice-normal-chat.test.js: contract checks passed');
