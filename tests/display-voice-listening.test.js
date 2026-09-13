const assert = require('assert');
const fs = require('fs');

const displayHtml = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/display.html',
    'utf8'
);
const serverJs = fs.readFileSync(
    'src/apps/server/boot/server-app.js',
    'utf8'
);
const voiceCommandJs = fs.readFileSync(
    'src/apps/web-mediacenter/modules/voice/voice-command-app-service.js',
    'utf8'
);
const deviceListJs = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/js/device-list.js',
    'utf8'
);
const voiceprintPanelJs = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js',
    'utf8'
);
const uploadHtml = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/upload.html',
    'utf8'
);

assert.match(displayHtml, /let voiceListeningEnabled = true/);
assert.match(displayHtml, /type: 'voiceConversationTtsFinished'/);
assert.match(displayHtml, /voiceListeningEnabled = data\.capabilities\.voiceRecording === true/);
assert.match(displayHtml, /function reportVoiceAvailability\(available\)/);
assert.match(displayHtml, /const ready = data\.ready === true[\s\S]*?reportVoiceAvailability\(ready\)/);
assert.match(displayHtml, /reportVoiceAvailability\(false\)/);
assert.doesNotMatch(displayHtml, /currentCapabilities\.voiceRecognition = voiceSupported/);
assert.match(displayHtml, /currentCapabilities = full[\s\S]*?sendVoiceStatus\(\)/);
const capabilityHandlerStart = displayHtml.indexOf('function handleCapabilitiesUpdated(data)');
const capabilityHandlerEnd = displayHtml.indexOf('// 旧 APK', capabilityHandlerStart);
const capabilityHandler = displayHtml.slice(capabilityHandlerStart, capabilityHandlerEnd);
assert.match(
    capabilityHandler,
    /voiceListeningEnabled && voiceSupported[\s\S]*?startVoiceRecording\(\)/,
    '能力确认后应主动启动服务端 ASR 录音'
);
assert.doesNotMatch(
    capabilityHandler,
    /if \(prevCaps && \(!prevCaps\.voiceRecording \|\| !prevCaps\.voiceRecognition\)\)/,
    '录音启动不能依赖旧能力状态的竞态条件'
);

const checkAsrStatusStart = displayHtml.indexOf('async function checkAsrStatus()');
const checkAsrStatusEnd = displayHtml.indexOf('function startRawPcmCapture', checkAsrStatusStart);
const checkAsrStatusBody = displayHtml.slice(checkAsrStatusStart, checkAsrStatusEnd);
assert.match(checkAsrStatusBody, /fetch\('\/api\/asr\/status'\)/);
assert.doesNotMatch(checkAsrStatusBody, /initLocalAsr\(\)/);

const startRecordingStart = displayHtml.indexOf('async function startVoiceRecording()');
const startRecordingEnd = displayHtml.indexOf('function startSilenceDetection()', startRecordingStart);
const startRecordingBody = displayHtml.slice(startRecordingStart, startRecordingEnd);
assert.doesNotMatch(startRecordingBody, /SherpaASR\.startStreaming/);

const recognitionStart = displayHtml.indexOf('async function sendAudioForRecognition');
const recognitionEnd = displayHtml.indexOf('// 只有服务器选中的 APK 提供端', recognitionStart);
const recognitionBody = displayHtml.slice(recognitionStart, recognitionEnd);
assert.match(recognitionBody, /fetch\('\/api\/asr\/recognize'/);
assert.match(recognitionBody, /FormData/);
assert.doesNotMatch(recognitionBody, /asrRecognizeAsync|asrRecognize\(/);
assert.doesNotMatch(recognitionBody, /SherpaASR\.(?:startStreaming|recognizeBuffer)/);
assert.match(
    recognitionBody,
    /data\.status === 'ignored'[\s\S]*?const ignoredText = String\(data\.text \|\| ''\)\.trim\(\)/,
    '显示端应保留有文字的 ignored 识别结果'
);
assert.match(
    recognitionBody,
    /const ignoredText = String\(data\.text \|\| ''\)\.trim\(\)[\s\S]*?updateVoiceTextDisplay\(ignoredText, true\)/,
    '显示端应显示有文字的无效识别结果'
);
assert.match(
    recognitionBody,
    /data\.ignoredText[\s\S]*?updateVoiceTextDisplay\(ignoredText, true\)/,
    '混合声纹分段中的无效文字也应显示'
);
const asrEndpointStart = serverJs.indexOf("app.post('/api/asr/recognize'");
const asrEndpointEnd = serverJs.indexOf("app.get('/api/asr/status'", asrEndpointStart);
const asrEndpointBody = serverJs.slice(asrEndpointStart, asrEndpointEnd);
assert.match(
    asrEndpointBody,
    /ignoredText/,
    '服务端 ASR 响应应保留被忽略分段的识别文字'
);
assert.match(serverJs, /display-voice-conversation/);
assert.match(serverJs, /isDisplayVoiceListeningEnabled\(displayData\)/);
assert.match(serverJs, /voiceConversationTtsFinished/);
assert.match(serverJs, /expiresAt:\s*Number\.isFinite\(conversation\.expiresAt\)/u, '服务端应广播会话到期时间');
assert.match(serverJs, /voiceConversationExpiresAt|expiresAt\s*=\s*Date\.now\(\)\s*\+/u, '服务端应在启动会话计时器时生成到期时间');
assert.match(serverJs, /pauseDisplayConversationTimer\(/u, 'TTS 开始时应暂停服务端会话计时');
assert.match(serverJs, /displayConversationTtsPlaybackKeys/u, '服务端应等待同一显示端全部 TTS 完成后恢复计时');
assert.match(serverJs, /temporaryConversationWindowMs/u, '服务端应读取临时窗口配置');
assert.match(serverJs, /conversationWindowMs/u, '服务端应读取持续对话窗口配置');
assert.match(serverJs, /addressedGroupMode/u, '服务端应支持角色名加内容的模式切换');
assert.match(serverJs, /temporaryConversationReplaced/u, '临时会话替换时应重置其他显示端');
assert.match(serverJs, /getTemporaryConversation/u, '服务端应提供临时会话快照请求');
assert.match(serverJs, /clearTemporaryConversation/u, '服务端应提供临时会话清空消息');
assert.match(serverJs, /temporaryConversationId/u, '临时聊天请求应携带全局会话 ID');
assert.match(serverJs, /function ensureTemporaryConversation\(displayId\)/u, '控制端临时发送应确保使用服务端当前全局会话');
assert.match(serverJs, /setVoiceConversationConfig/u, '服务端应提供窗口配置写入消息');
assert.match(serverJs, /type: 'voiceConversationConfig'/u, '服务端应广播窗口配置权威值');
assert.match(voiceprintPanelJs, /setVoiceConversationConfig/u, '控制端应发送窗口配置');
assert.match(voiceprintPanelJs, /temporaryWindowSeconds/u, '控制端应渲染临时窗口设置');
assert.match(voiceprintPanelJs, /conversationWindowSeconds/u, '控制端应渲染持续窗口设置');
assert.match(voiceprintPanelJs, /setAddressedGroupMode/u, '控制端应提供临时/一次性群聊切换');
assert.match(voiceprintPanelJs, /addressedGroupMode/u, '控制端应同步角色名加内容模式');
const controlChatJs = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/js/chat.js',
    'utf8'
);
const controlWebsocketJs = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/js/websocket.js',
    'utf8'
);
assert.match(controlChatJs, /data-chat-tab="temporary"/u, '控制端应增加临时页签');
assert.match(controlChatJs, /handleTemporaryConversation/u, '控制端应渲染临时会话快照');
assert.match(controlChatJs, /temporaryConversation:\s*mode === 'temporary'/u, '临时页签发送应标记临时会话');
assert.match(controlChatJs, /temporaryConversationId:\s*mode === 'temporary'/u, '临时页签发送应携带当前临时会话 ID');
assert.doesNotMatch(controlChatJs, /临时页签只显示语音临时会话/u, '临时页签不应保持只读提示');
assert.match(controlWebsocketJs, /data.type === 'temporaryConversation'/u, '控制端 WebSocket 应接收临时会话快照');
assert.match(uploadHtml, /voiceConversationWindowPanel/u, '控制端页面应提供窗口设置面板');
assert.match(displayHtml, /voiceConversationTimerPaused/u, '显示端应保存会话计时暂停状态');
assert.match(displayHtml, /voiceConversationRemainingMs/u, '显示端应冻结 TTS 期间剩余时间');
assert.match(serverJs, /voiceprintEnabledNow = config\.get\('voiceprint\.enabled', true\)/);
assert.match(serverJs, /isBuiltin: voiceCommand\.isWakeFreeVoiceCommand/);
assert.match(voiceCommandJs, /function isBuiltinVoiceCommand\(text\)/);
assert.match(serverJs, /function normalizeDisplayUserCapabilities\(capabilities\)/);
assert.doesNotMatch(serverJs, /delete normalized\.voiceRecognition/);
assert.match(serverJs, /\.\.\.data\.capabilities/);
assert.match(serverJs, /normalizeDisplayUserCapabilities\(savedState\.userCapabilities\)/);

const voiceInputStart = serverJs.indexOf('function processDisplayVoiceInput(displayId, data, ws = null)');
const voiceStatusStart = serverJs.indexOf("} else if (data.type === 'voiceStatus' && displayData)", voiceInputStart);
const voiceInputHandler = serverJs.slice(voiceInputStart, voiceStatusStart);
const voiceprintRejectIndex = voiceInputHandler.indexOf('data.speaker === null');
const controlBroadcastIndex = voiceInputHandler.indexOf("type: 'voiceInput'");
assert.ok(voiceprintRejectIndex >= 0, '服务端应保留未匹配声纹判断');
assert.ok(controlBroadcastIndex >= 0, '服务端应广播 voiceInput');
assert.ok(controlBroadcastIndex < voiceprintRejectIndex, '控制端回传必须先于未匹配声纹过滤');
const deduplicatorRequireIndex = serverJs.indexOf("require('../modules/voice/voice-input-deduplicator')");
const deduplicatorCheckIndex = voiceInputHandler.indexOf('sameSpeakerVoiceInputDeduplicator.check(');
const conversationRouteIndex = voiceInputHandler.indexOf('handleDisplayConversationInput(');
assert.ok(deduplicatorRequireIndex >= 0, '服务端应加载同一声纹跨显示端 ASR 去重器');
assert.ok(deduplicatorCheckIndex >= 0, 'voiceInput 分支应调用同一声纹去重器');
assert.ok(deduplicatorCheckIndex < controlBroadcastIndex, '去重应发生在控制端广播之前');
assert.ok(deduplicatorCheckIndex < conversationRouteIndex, '去重应发生在语音会话处理之前');
assert.match(voiceInputHandler, /isDuplicate/);
assert.match(voiceInputHandler, /speechStartAt:\s*data\.speechStartAt/);
assert.match(voiceInputHandler, /speechEndAt:\s*data\.speechEndAt/);
assert.match(displayHtml, /sendAudioForRecognition\(audioBlob[\s\S]*speechStartAt/);
assert.match(displayHtml, /speechEndAt/);
assert.match(deviceListJs, /voiceInputByDisplay: new Map\(\)/);
assert.match(deviceListJs, /this\.voiceInputByDisplay\.set\(displayId, latest\)/);
assert.doesNotMatch(deviceListJs, /voiceInputByDisplay\.set\(displayId, \[[^\]]*latest/);

const voiceControlStart = deviceListJs.indexOf('renderVoiceControl(display)');
const voiceControlEnd = deviceListJs.indexOf('renderSettingControl(node)', voiceControlStart);
const voiceControl = deviceListJs.slice(voiceControlStart, voiceControlEnd);
assert.match(voiceControl, /input\.addEventListener\(['"]change['"]/);
assert.match(voiceControl, /updateCapability\(display\.id, ['"]voiceRecording['"], event\.target\.checked\)/);

console.log('display-voice-listening.test.js: contract checks passed');
