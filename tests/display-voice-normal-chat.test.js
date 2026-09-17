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
const completeStart = handler.indexOf('onComplete:');
const completeEnd = handler.indexOf('onError:', completeStart);
assert.ok(completeStart >= 0 && completeEnd > completeStart, '应能定位聊天完成回调');
const completeHandler = handler.slice(completeStart, completeEnd);
assert.match(
    completeHandler,
    /onComplete:\s*\(fullMessage,\s*history,\s*reasoning,\s*speech\)/,
    '聊天完成回调应接收独立的 reasoning 和 speech'
);
assert.match(
    completeHandler,
    /detailText:\s*speech\s*\|\|\s*fullMessage/,
    '语音普通聊天完成后显示端气泡应收到按生成顺序去标签的 think 与回答'
);
const sentenceStart = handler.indexOf('onSentence:');
const sentenceEnd = handler.indexOf('onComplete:', sentenceStart);
assert.ok(sentenceStart >= 0 && sentenceEnd > sentenceStart, '应能定位聊天 TTS 和完成回调');
const sentenceHandler = handler.slice(sentenceStart, sentenceEnd);
assert.match(sentenceHandler, /routeVoiceToPreferredDisplay/);
assert.doesNotMatch(
    sentenceHandler,
    /sendToDisplay\(voiceOriginDisplayId/,
    '语音普通聊天 TTS 应通过统一目标解析后定向播放'
);
assert.match(
    sentenceHandler,
    /resolveCurrentVoicePlaybackTarget\(preferredDisplayId\)/,
    '语音普通聊天 TTS 应优先来源显示端并按在线能力兜底'
);
assert.match(
    server,
    /voiceOriginDisplayId:\s*isDisplayVoiceInput\s*\?\s*targetDisplayId\s*:\s*null/,
    '显示端语音进入聊天路径时应传递来源显示端'
);
assert.match(
    server,
    /const conversationActive = \['activeGroup',\s*'activePrivate'\]\.includes\(conversation\.state\??\.state\)/,
    '显示端唤醒后的语音应把活跃会话标记传给命令处理器'
);
const audioChunkStart = server.indexOf("wsServer.registerHandler('audioChunk'");
const audioChunkEnd = server.indexOf("// 注册控制端消息 handler", audioChunkStart);
assert.ok(audioChunkStart >= 0 && audioChunkEnd > audioChunkStart, '应能定位音频流入口');
const audioChunkHandler = server.slice(audioChunkStart, audioChunkEnd);
assert.match(
    audioChunkHandler,
    /const conversationActive = \['activeGroup',\s*'activePrivate'\]\.includes\(conversation\.state\??\.state\)/,
    '音频流识别也应把活跃会话标记传给命令处理器'
);
assert.match(
    server,
    /voiceCommand门控[\s\S]{0,260}accepted[\s\S]{0,260}conversationActive/,
    '服务端应记录 voiceCommand 门控状态，便于诊断语音未进入聊天的问题'
);
const manualChatSessionStart = server.indexOf("} else if (data.type === 'setChatSession') {");
const manualChatSessionEnd = server.indexOf("} else if (data.type === 'listPrivateSessions') {", manualChatSessionStart);
assert.ok(
    manualChatSessionStart >= 0 && manualChatSessionEnd > manualChatSessionStart,
    '应能定位控制端聊天会话保存入口'
);
const manualChatSessionHandler = server.slice(manualChatSessionStart, manualChatSessionEnd);
assert.match(
    manualChatSessionHandler,
    /buildManualChatVoiceConversationUpdates\(\{[\s\S]*?offlineMode:\s*OFFLINE_NODE_MODE/u,
    'offline APK 手动切换聊天模式后应同步当前全局模式到语音会话'
);
assert.match(
    manualChatSessionHandler,
    /previousSession\.mode\s*!==\s*session\.mode[\s\S]*?previousSession\.privateTarget\s*!==\s*session\.privateTarget/u,
    '只有聊天模式或私聊目标变化时才应触发语音会话同步'
);
assert.match(
    manualChatSessionHandler,
    /source:\s*data\.source/,
    '语音会话同步必须使用 setChatSession 的来源以排除被动状态回传'
);
assert.match(
    manualChatSessionHandler,
    /armDisplayConversationTimer/,
    '同步后的显示端语音会话应沿用现有服务端计时'
);
assert.match(server, /target:\s*result\.target/);
assert.match(server, /sessionId:\s*result\.sessionId/);
assert.match(server, /templateTarget:\s*result\.templateTarget/);
assert.match(
    server,
    /temporaryConversation:\s*data\.temporaryConversation === true \|\| data\.mode === 'temporary'/,
    '控制端临时页签消息应进入临时会话处理链路'
);
assert.match(
    handler,
    /ensureTemporaryConversation\(displayId \|\| voiceOriginDisplayId \|\| null\)/,
    '临时聊天应确保使用服务端当前唯一会话'
);
assert.match(
    chat,
    /temporaryConversationId:\s*mode === 'temporary'/,
    '控制端发送临时消息应携带当前会话 ID'
);
assert.match(
    server,
    /const sendToControl = isDisplayVoiceInput\s*\n\s*\? \(msg\) => broadcastToControls\(msg\)/,
    '显示端语音普通聊天回包应广播到控制端'
);
assert.match(
    server,
    /onTts: isDisplayVoiceInput[\s\S]{0,220}sendVoiceInputTts\(text,\s*\{[\s\S]{0,120}preferredDisplayId:\s*targetDisplayId/,
    '显示端语音命令 TTS 应使用来源端优先的单目标路由'
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
