const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createDisplayVoiceListeningConfig } = require('../src/apps/server/modules/voice/display-voice-listening-config');
const html = fs.readFileSync('src/apps/web-mediacenter/ui/public/display.html', 'utf8');
const controls = fs.readFileSync('src/apps/web-mediacenter/ui/public/js/display-voice-controls.js', 'utf8');

function inlineFunction(name) {
    const pattern = new RegExp(`        (?:async )?function ${name}\\(`);
    const start = html.search(pattern);
    assert.ok(start >= 0, `${name} 存在`);
    const tail = html.slice(start);
    const end = tail.slice(1).search(/\n        (?:async )?function /u);
    return end < 0 ? tail : tail.slice(0, end + 1);
}

function runtime(extra = '') {
    const calls = [];
    const timers = new Map();
    let sequence = 0;
    const window = {
        DisplayStage: { publish: (type, payload) => calls.push([type, payload]), send: (message) => { calls.push(['send', message]); return true; } },
        DisplayChat: { sendVoiceMessage: (text) => calls.push(['chat', text]) },
        showToast: (text) => calls.push(['error', text])
    };
    const context = vm.createContext({
        window, calls, timers, console, Date, WebSocket: { OPEN: 1 },
        setTimeout: (fn) => { timers.set(++sequence, fn); return sequence; },
        clearTimeout: (id) => timers.delete(id),
        FormData: class { constructor() { this.fields = []; } append(...field) { this.fields.push(field); } },
        fetch: async (_url, options) => { calls.push(['fetch', options.body.fields]); return { ok: true, json: async () => ({ status: 'success', text: '你好' }) }; }
    });
    vm.runInContext(`
        let voiceContinuousEnabled = false, voiceListeningConfigReady = true, isAlwaysListening = false;
        let manualVoiceRecording = false, manualVoiceRecordingTimer = null;
        let currentVoiceVadRms = 0, lastVoiceAsrText = '';
        let vadThreshold = 0.1, vadSilenceDurationMs = 500, vadMinSpeechDurationMs = 300;
        let voiceInteractionEpoch = 0, voiceCaptureStartToken = 0, voiceCaptureStarting = false;
        const voiceRecognitionRequests = new Map();
        let displayWs = { readyState: 1 }, displayId = 'one', displayPageActive = true;
        let isListening = false, hasSpeech = false, speechStartTime = null, silenceStartTime = null;
        let globalRecordingPaused = false, voiceListeningEnabled = true, voiceSupported = true;
        let pauseRecordingDuringPlayback = false;
        function hasActiveTtsPlayback() { return false; }
        let currentCapabilities = { voiceRecording: true }, voiceRecordingMode = 'asr', displayRecordingSession = null;
        let activeRecordingPurpose = 'asr', voiceCooldownUntil = 0, pcmCapture = null, micStream = null;
        let ttsRecordingPaused = false, wasListeningBeforePlayback = false, vadNoiseTestActive = false;
        let vadNoiseTestRequestId = null, textTtsPlaybackActive = false;
        let ttsAudio = { paused: true, ended: false, addEventListener() {} };
        let remoteTtsPlaybackIds = new Set();
        // 执行正式播报处理函数，不能模拟错误拼写而掩盖点击链路的ReferenceError。
        function stopTtsPlayback() { calls.push(['stop']); }
        function clearRemoteTextPlayback() {}
        ${inlineFunction('handleTTS')}
        function resumeVoiceRecordingAfterTts() { calls.push(['resume']); }
        function clearTtsRecordingResumeTimer() {}
        function sendVoiceStatus() { publishVoiceRuntime(); }
        function sendVoiceVadNoiseResult() {}
        function releaseVoiceRecordingResources() { calls.push(['release']); pcmCapture = null; micStream = null; }
        function takeRawPcmWav() { return 'wav'; }
        function updateVoiceTextDisplay(text) { calls.push(['text', text]); }
        async function startVoiceRecording() { isListening = true; pcmCapture = {}; calls.push(['start']); }
        ${html.slice(html.indexOf('        function getVoiceInteractionSnapshot()'), html.indexOf('        window.DisplayVoiceRuntime'))}
        ${inlineFunction('stopVoiceRecording')}
        ${inlineFunction('formatVoiceprintDisplaySegment')}
        ${inlineFunction('getVoiceAsrDisplayText')}
        ${inlineFunction('sendAudioForRecognition')}
        ${extra}
    `, context);
    return { context, calls, timers, run: (code) => vm.runInContext(code, context) };
}

test('六状态按实际播放、识别、思考、采集和待机归约', () => {
    const window = {};
    vm.runInNewContext(controls, { window });
    const status = window.DisplayVoiceControls.deriveStatus;
    assert.equal(status({}), 'stopped');
    assert.equal(status({ continuous: true, listening: true }), 'idle');
    assert.equal(status({ continuous: true, listening: true, hasSpeech: true }), 'listening');
    assert.equal(status({ manual: true }), 'listening');
    assert.equal(status({ manual: true }, true), 'thinking');
    assert.equal(status({ recognizing: 2 }, true), 'recognizing');
    assert.equal(status({ speaking: true, recognizing: 2 }, true), 'speaking');
});

test('按 displayId 保存，控制端广播权威值，其他显示端不受影响', () => {
    const ws = { readyState: 1 };
    const other = { readyState: 1 };
    const displays = new Map([['one', { ws, state: {} }], ['two', { ws: other, state: {} }]]);
    const persisted = [], sent = [], broadcast = [];
    const service = createDisplayVoiceListeningConfig({ displays, isControl: () => false,
        persist: (display, values) => persisted.push([display, values]),
        sendToDisplay: (...args) => sent.push(args), broadcast: (message) => broadcast.push(message) });
    assert.equal(service.snapshot('one').enabled, true);
    service.handle({ type: 'setDisplayVoiceListeningConfig', enabled: false, displayId: 'two', requestId: 'r' }, ws, 'one');
    assert.equal(displays.get('one').state.voiceContinuousEnabled, false);
    assert.equal(service.snapshot('two').enabled, true);
    assert.equal(persisted.length, 1);
    assert.deepEqual(sent[0], ['one', { type: 'displayVoiceListeningConfig', displayId: 'one', enabled: false, requestId: 'r', success: true }]);
    assert.deepEqual(broadcast[0], sent[0][1]);
    service.handle({ type: 'setDisplayVoiceListeningConfig', displayId: 'two', enabled: false }, ws);
    assert.equal(persisted.length, 1, '其他显示端不能更改目标');
});

test('非法值或持久化失败回传旧权威状态，控制端可设置目标', () => {
    const errors = [];
    const ws = { readyState: 1, send: (text) => errors.push(JSON.parse(text)) };
    const displays = new Map([['one', { ws: {}, state: { voiceContinuousEnabled: false } }]]);
    const service = createDisplayVoiceListeningConfig({ displays, isControl: (socket) => socket === ws,
        persist: () => { throw new Error('磁盘错误'); }, sendToDisplay() {}, broadcast() {} });
    for (const enabled of ['true', true]) service.handle({ type: 'setDisplayVoiceListeningConfig', displayId: 'one', enabled }, ws);
    assert.equal(errors.length, 2);
    assert.ok(errors.every((error) => error.enabled === false && error.success === false));
});

test('持续模式点击只打断并继续采集，手动模式先打断再单次启动', async () => {
    const r = runtime();
    await r.run('activateVoiceInteraction()');
    assert.equal(r.calls[0][0], 'stop');
    assert.equal(r.calls[1][0], 'send');
    assert.ok(r.calls.find((call) => call[0] === 'start'));
    assert.equal(r.run('manualVoiceRecording'), true);
    assert.equal(r.timers.size, 1);
    r.run('voiceContinuousEnabled = true; manualVoiceRecording = false; isListening = true');
    const starts = r.calls.filter((call) => call[0] === 'start').length;
    await r.run('activateVoiceInteraction()');
    assert.equal(r.calls.filter((call) => call[0] === 'start').length, starts);
});

test('单次再次点击满足语音和静音等待才识别，并只发送一次聊天', async () => {
    const r = runtime();
    await r.run('activateVoiceInteraction()');
    r.run('hasSpeech = true; speechStartTime = Date.now() - 1000; silenceStartTime = Date.now() - 600');
    await r.run('activateVoiceInteraction()');
    assert.equal(r.run('manualVoiceRecording || isListening'), false);
    assert.equal(r.timers.size, 0);
    assert.equal(r.calls.filter((call) => call[0] === 'start').length, 1);
    assert.deepEqual(r.calls.filter((call) => call[0] === 'chat'), [['chat', '你好']]);
    assert.ok(r.calls.find((call) => call[0] === 'fetch')[1].some((field) => field[0] === 'manualVoiceInput' && field[1] === 'true'));
});

test('再次点击条件未满足立即中断，不提取音频或等待静音', async () => {
    for (const state of [
        'hasSpeech = false',
        'hasSpeech = true; speechStartTime = Date.now() - 1000; silenceStartTime = null',
        'hasSpeech = true; speechStartTime = Date.now() - 1000; silenceStartTime = Date.now() - 100',
        'hasSpeech = true; speechStartTime = Date.now() - 100; silenceStartTime = Date.now() - 600',
        'hasSpeech = true; speechStartTime = Date.now() - 1000; silenceStartTime = Date.now() - 600; currentVoiceVadRms = 0.2'
    ]) {
        const r = runtime("function takeRawPcmWav() { throw new Error('不应提取未合格音频'); }");
        await r.run('activateVoiceInteraction()');
        r.run(state);
        await r.run('activateVoiceInteraction()');
        assert.equal(r.run('manualVoiceRecording || isListening'), false, state);
        assert.equal(r.timers.size, 0);
        assert.equal(r.calls.filter((call) => call[0] === 'fetch').length, 0);
        assert.equal(r.calls.filter((call) => call[0] === 'release').length, 2);
    }
});

test('共用判断保留静音严格大于和最短语音大于等于边界', () => {
    const r = runtime();
    r.run('hasSpeech = true; speechStartTime = 1000; silenceStartTime = 1500');
    assert.equal(r.run('isVoiceSegmentReadyForRecognition(2000)'), false);
    assert.equal(r.run('isVoiceSegmentReadyForRecognition(2001)'), true);
    r.run('vadSilenceDurationMs = 100; speechStartTime = 1700');
    assert.equal(r.run('isVoiceSegmentReadyForRecognition(1999)'), false);
    assert.equal(r.run('isVoiceSegmentReadyForRecognition(2000)'), true);
});

test('真实RMS回调在静音等待完成后自动结束单次录音且不重复提交', async () => {
    const r = runtime(`
        let silenceDetectionRunning = true;
        function startSilenceDetection() {}
        ${inlineFunction('finishVoiceSegment')}
        ${inlineFunction('handleVoiceVadRms')}
    `);
    await r.run('activateVoiceInteraction()');
    r.run('pcmCapture.beginSegment = () => {}; handleVoiceVadRms(0.2); speechStartTime = Date.now() - 1000; handleVoiceVadRms(0.01)');
    assert.equal(r.run('manualVoiceRecording && isListening'), true);
    assert.equal(r.calls.filter((call) => call[0] === 'fetch').length, 0);
    r.run('silenceStartTime = Date.now() - 600; handleVoiceVadRms(0.01)');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(r.run('manualVoiceRecording || isListening'), false);
    await r.run('finishManualVoiceRecording()');
    assert.equal(r.calls.filter((call) => call[0] === 'fetch').length, 1);
    assert.deepEqual(r.calls.filter((call) => call[0] === 'chat'), [['chat', '你好']]);
});

test('静音完成复用单次提交，无语音超时不发送空音频', async () => {
    const r = runtime(`function startSilenceDetection() {}\n${inlineFunction('finishVoiceSegment')}`);
    await r.run('activateVoiceInteraction()');
    const timeout = [...r.timers.values()][0];
    timeout();
    assert.equal(r.run('isListening || manualVoiceRecording'), false);
    assert.equal(r.calls.filter((call) => call[0] === 'fetch').length, 0);
    await r.run('activateVoiceInteraction()');
    r.run('hasSpeech = true; speechStartTime = Date.now() - 1000; silenceStartTime = Date.now() - 600');
    await r.run('finishVoiceSegment()');
    assert.equal(r.calls.filter((call) => call[0] === 'chat').length, 1);
    await r.run('activateVoiceInteraction()');
    r.run('hasSpeech = true; speechStartTime = Date.now() - 1000; silenceStartTime = null');
    await [...r.timers.values()][0]();
    assert.equal(r.run('isListening || manualVoiceRecording'), false);
    assert.equal(r.calls.filter((call) => call[0] === 'chat').length, 1, '超时也不能绕过静音');
});

test('不匹配声纹分段不会聊天，多个有效分段合并一次', async () => {
    const r = runtime();
    r.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', segments: [
        { text: '忽略', speaker: null }, { text: '第一句', speaker: '甲' }, { text: '第二句' }
    ] }) });
    await r.run("sendAudioForRecognition('wav', { manualVoiceInput: true, epoch: 0 })");
    assert.deepEqual(r.calls.filter((call) => call[0] === 'chat'), [['chat', '第一句，第二句']]);
    r.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', text: '忽略', speaker: null }) });
    await r.run("sendAudioForRecognition('wav', { manualVoiceInput: true, epoch: 0 })");
    assert.equal(r.calls.filter((call) => call[0] === 'chat').length, 1);
});

test('迟到 ASR 在模式切换、断线或全局暂停后不能再发送聊天', async () => {
    for (const cancel of ['voiceInteractionEpoch++', 'displayWs = null', 'globalRecordingPaused = true', 'voiceListeningEnabled = false']) {
        const r = runtime();
        let resolve;
        r.context.fetch = () => new Promise((done) => { resolve = done; });
        const promise = r.run("sendAudioForRecognition('wav', { manualVoiceInput: true, epoch: 0 })");
        assert.equal(r.run('getVoiceInteractionSnapshot().recognizing'), 1);
        r.run(cancel);
        resolve({ ok: true, json: async () => ({ status: 'success', text: '迟到' }) });
        await promise;
        assert.equal(r.calls.filter((call) => call[0] === 'chat').length, 0);
        assert.equal(r.calls.filter((call) => call[0] === 'voice.asr-result').length, 0);
        assert.equal(r.run('getVoiceInteractionSnapshot().recognizing'), 0);
    }
});

test('能力关闭、全局暂停、远端回放用途下按钮不启动录音', async () => {
    for (const unavailable of ['voiceListeningEnabled = false', 'globalRecordingPaused = true', "voiceRecordingMode = 'realtime'", 'voiceSupported = false']) {
        const r = runtime();
        r.run(unavailable);
        await assert.rejects(r.run('activateVoiceInteraction()'));
        assert.equal(r.calls.filter((call) => call[0] === 'start').length, 0);
        assert.equal(r.calls[0][0], 'stop', '仍能打断播报');
    }
});

test('异步麦克风启动去重，取消后迟到轨道立即释放', async () => {
    const r = runtime(`
        let voiceCaptureMode = 'webview';
        function isNativeAudioCaptureMode() { return false; }
        function ensureBluetoothScoForVoice() {}
        function startSilenceDetection() {}
        function startRawPcmCapture() { calls.push(['pcm']); return true; }
        function sendVoiceCaptureStatus() {}
        function getWebViewActualAudioDevice() { return {}; }
        ${inlineFunction('startVoiceRecording')}
    `);
    let resolve, requests = 0, stopped = 0;
    r.context.openWebViewAudioStream = () => { requests++; return new Promise((done) => { resolve = done; }); };
    r.run('manualVoiceRecording = true');
    const starting = r.run('startVoiceRecording()');
    await r.run('startVoiceRecording()');
    assert.equal(requests, 1);
    r.run('stopVoiceRecording(false)');
    resolve({ stream: { getTracks: () => [{ stop: () => stopped++ }] } });
    await starting;
    assert.equal(stopped, 1);
    assert.equal(r.run('isListening || manualVoiceRecording || voiceCaptureStarting'), false);
    assert.equal(r.calls.filter((call) => call[0] === 'pcm').length, 0);
});

test('开关等待权威配置，失败恢复旧值，聊天完成和断线清理思考状态', () => {
    const handlers = new Map(), subscriptions = new Map(), sent = [], timers = new Map();
    const refs = {};
    for (const id of ['displayVoiceContinuous', 'displayVoiceAction', 'displayVoiceActionStatus', 'displayVoiceVadValue', 'displayVoiceAsrResult']) {
        refs[id] = { dataset: {}, attributes: {}, addEventListener: (event, fn) => handlers.set(`${id}:${event}`, fn),
            setAttribute(name, value) { this.attributes[name] = value; } };
    }
    const snapshot = { continuous: false, connected: true, configReady: true, listening: false };
    const window = {
        document: { getElementById: (id) => refs[id] },
        setTimeout: (fn) => { timers.set(1, fn); return 1; }, clearTimeout: (id) => timers.delete(id), showToast() {}
    };
    vm.runInNewContext(controls, { window });
    window.DisplayVoiceControls.init({
        runtime: { snapshot: () => snapshot, configure: (enabled) => { snapshot.continuous = enabled; }, activate() {} },
        send: (message) => { sent.push(message); return true; }, getState: () => ({ displayId: 'one' }),
        bus: { subscribe: (type, fn) => subscriptions.set(type, fn) }
    });
    const toggle = refs.displayVoiceContinuous;
    toggle.checked = true;
    handlers.get('displayVoiceContinuous:change')();
    assert.equal(toggle.checked, false, '保存成功之前保留权威值');
    assert.equal(toggle.disabled, true);
    subscriptions.get('server.message')({ type: 'displayVoiceListeningConfig', displayId: 'one', enabled: false, success: false, requestId: sent[0].requestId });
    assert.equal(toggle.checked, false);
    assert.equal(toggle.disabled, false);
    assert.equal(timers.size, 0);
    subscriptions.get('chat.activity')({ requestId: 'chat', active: true });
    assert.equal(refs.displayVoiceActionStatus.textContent, '助手 · 思考');
    subscriptions.get('chat.activity')({ requestId: 'chat', active: false });
    assert.equal(refs.displayVoiceActionStatus.textContent, '助手 · 已停止');
    subscriptions.get('chat.activity')({ requestId: 'chat2', active: true });
    subscriptions.get('transport.changed')({ available: false });
    assert.equal(refs.displayVoiceActionStatus.textContent, '助手 · 已停止');
    let name = '小爱';
    window.DisplayChat = { getVoiceStatusName: () => name };
    subscriptions.get('chat.status-name')();
    assert.equal(refs.displayVoiceActionStatus.textContent, '小爱 · 已停止');
    assert.equal(refs.displayVoiceAction.attributes['aria-label'], '小爱 · 已停止，开始一次语音输入');
    name = '工作助手';
    snapshot.manual = true;
    subscriptions.get('chat.status-name')();
    assert.equal(refs.displayVoiceActionStatus.textContent, '工作助手 · 监听中');
    snapshot.vadActive = true;
    snapshot.vadRms = 0.026;
    subscriptions.get('voice.vad')();
    assert.equal(refs.displayVoiceVadValue.textContent, 'VAD 0.03');
    assert.equal(refs.displayVoiceVadValue.hidden, false);
    assert.equal(refs.displayVoiceActionStatus.textContent, '工作助手 · 监听中');
    snapshot.vadActive = false;
    subscriptions.get('voice.runtime')();
    assert.equal(refs.displayVoiceVadValue.hidden, true);
    snapshot.asrText = '<img>识别结果';
    subscriptions.get('voice.asr-result')({ text: snapshot.asrText });
    assert.equal(refs.displayVoiceAsrResult.textContent, snapshot.asrText);
    assert.equal(refs.displayVoiceAsrResult.hidden, false);
    snapshot.asrText = '';
    subscriptions.get('voice.asr-result')({ text: '' });
    assert.equal(refs.displayVoiceAsrResult.hidden, true);
});

test('真实RMS回调只有两位小数变化才发布反馈，不改变VAD判定', () => {
    const r = runtime(`
        let silenceDetectionRunning = true;
        ${inlineFunction('handleVoiceVadRms')}
    `);
    r.run('isListening = true; pcmCapture = { beginSegment() {} }; handleVoiceVadRms(0.012); handleVoiceVadRms(0.014); handleVoiceVadRms(0.017)');
    assert.equal(r.calls.filter((call) => call[0] === 'voice.vad').length, 2);
    assert.equal(r.run('currentVoiceVadRms'), 0.017);
    assert.equal(r.run('hasSpeech'), false, '反馈数值不改变阈值含义');
    r.run('handleVoiceVadRms(NaN); handleVoiceVadRms(-1); isListening = false; handleVoiceVadRms(0.5)');
    assert.equal(r.calls.filter((call) => call[0] === 'voice.vad').length, 2);
    r.run('isListening = true; handleVoiceVadRms(0.2)');
    assert.equal(r.run('hasSpeech'), true);
    r.run('ttsRecordingPaused = true');
    assert.equal(r.run('getVoiceInteractionSnapshot().vadActive'), false);
});

test('本端有效ASR在底部回显，包括未匹配声纹；聊天仍只发送有效文本', async () => {
    const r = runtime();
    r.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', segments: [
        { text: '未匹配', speaker: null }, { text: '有效内容', speaker: '甲' }
    ] }) });
    await r.run("sendAudioForRecognition('wav', { manualVoiceInput: true, epoch: 0 })");
    const result = r.calls.find((call) => call[0] === 'voice.asr-result')[1].text;
    assert.match(result, /未匹配/u);
    assert.match(result, /\[甲\] 有效内容/u);
    assert.deepEqual(r.calls.filter((call) => call[0] === 'chat'), [['chat', '有效内容']]);
    assert.equal(r.calls.filter((call) => call[0] === 'text').length, 0, '不再共享旧字幕节点');
    r.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'ignored', text: '无效文本' }) });
    await r.run("sendAudioForRecognition('wav', { manualVoiceInput: true, epoch: 0 })");
    assert.equal(r.run('lastVoiceAsrText'), '无效文本');
    assert.equal(r.calls.filter((call) => call[0] === 'chat').length, 1);
    r.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', text: '' }) });
    await r.run("sendAudioForRecognition('wav', { manualVoiceInput: true, epoch: 0 })");
    assert.equal(r.run('lastVoiceAsrText'), '');
    r.context.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', text: '连续识别' }) });
    await r.run("sendAudioForRecognition('wav', { epoch: 0 })");
    assert.equal(r.run('lastVoiceAsrText'), '连续识别');
});

test('关闭持续监听后，TTS 结束不会自行重开麦克风', () => {
    const r = runtime(`
        function startSilenceDetection() { calls.push(['vad']); }
        ${inlineFunction('resumeVoiceRecordingAfterTts')}
    `);
    r.run(`ttsRecordingPaused = true; wasListeningBeforePlayback = true;
        pcmCapture = { active: true, isNative: true, setPaused: () => calls.push(['unpause']) };
        resumeVoiceRecordingAfterTts();`);
    assert.equal(r.run('isListening || manualVoiceRecording'), false);
    assert.equal(r.calls.filter((call) => call[0] === 'unpause').length, 0);
});

test('播报期间新开启持续模式先等待，播报结束再启动', () => {
    const blocked = runtime(`${inlineFunction('startVoiceRecording')}\nfunction hasActiveTtsPlayback() { return true; }`);
    blocked.run('isAlwaysListening = true; pauseRecordingDuringPlayback = true; startVoiceRecording()');
    assert.equal(blocked.run('isListening || voiceCaptureStarting'), false);
    const r = runtime(inlineFunction('scheduleTtsRecordingResume'));
    r.run('isAlwaysListening = true; scheduleTtsRecordingResume()');
    assert.equal(r.timers.size, 1);
    [...r.timers.values()][0]();
    assert.equal(r.calls.filter((call) => call[0] === 'start').length, 1);
});

test('手动识别和关闭模式的在途普通结果不进入服务端命令，持续模式沿用旧链路', () => {
    const server = fs.readFileSync('src/apps/server/boot/server-app.js', 'utf8');
    const begin = server.indexOf('function processRecognizedAsrResultForDisplay');
    const end = server.indexOf("app.post('/api/asr/recognize'", begin);
    const calls = [];
    const displays = new Map([['one', { state: { voiceContinuousEnabled: false } }]]);
    const context = vm.createContext({
        globalRecordingPaused: false, displayClients: displays,
        normalizeAsrSegments: () => [], normalizeAsrText: (text) => text,
        hasValidContent: () => true, getAsrSegmentTiming: () => ({}),
        processDisplayVoiceInput: (...args) => calls.push(args)
    });
    vm.runInContext(server.slice(begin, end), context);
    vm.runInContext("processRecognizedAsrResultForDisplay('one', { text: '你好' }, {})", context);
    assert.equal(calls.length, 0);
    displays.get('one').state.voiceContinuousEnabled = true;
    vm.runInContext("processRecognizedAsrResultForDisplay('one', { text: '你好' }, { manualVoiceInput: true })", context);
    assert.equal(calls.length, 0);
    vm.runInContext("processRecognizedAsrResultForDisplay('one', { text: '你好' }, {})", context);
    assert.equal(calls.length, 1);
});

test('显示页面独立脚本均能编译，手动识别服务端不再重复进入语音命令', () => {
    for (const [, attributes, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gu)) {
        if (!attributes.includes('src=') && !attributes.includes('importmap')) new vm.Script(body);
    }
    const server = fs.readFileSync('src/apps/server/boot/server-app.js', 'utf8');
    const start = server.indexOf('function processRecognizedAsrResultForDisplay');
    assert.match(server.slice(start, start + 320), /requestContext\?\.manualVoiceInput/u);
    assert.match(html, /id="displayVoiceContinuous"/u);
    assert.match(html, /id="displayVoiceActionStatus"/u);
    assert.doesNotMatch(html, /id="displayChatTtsStop"/u);
});
