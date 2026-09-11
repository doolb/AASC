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

console.log('display-voice-listening.test.js: 40/40 passed');
