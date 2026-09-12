'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const nodeMain = read('src/apps/voice-display-node/main.js');
const nodeClient = read('src/apps/voice-display-node/asr-client.js');
const nodeInput = read('src/apps/voice-display-node/windows-text-input.js');
const nodeConfig = JSON.parse(read('src/apps/voice-display-node/config.json'));
const audioPlayer = read('src/apps/voice-display-node/audio-player.js');
const server = read('src/apps/server/boot/server-app.js');

test('Node 子显示端注册全局快捷键并维护 Windows 语音输入状态', () => {
    assert.match(nodeMain, /windows-text-input/u, 'Node 应加载 Windows 输入注入模块');
    assert.match(nodeInput, /Ctrl\+Alt\+Space/u, 'Node 应使用约定的全局快捷键');
    assert.match(nodeMain, /textInputMode/u, 'Node 应维护本地语音输入状态');
    assert.match(nodeMain, /onToggleTextInputMode/u, 'Node 应提供快捷键切换入口');
});

test('Node 子显示端将 ASR 文本分流到 Windows 窗口并处理发送/返回命令', () => {
    assert.match(nodeMain, /insertText\(/u, '输入模式下普通文本应调用系统文本注入');
    assert.match(nodeMain, /backspaceText\(/u, '返回命令应调用系统 Backspace');
    assert.match(nodeMain, /sendEnter\(/u, '发送命令应调用系统 Enter');
    assert.match(nodeMain, /开始输入/u, 'Node 应识别开始输入激活词');
    assert.match(nodeMain, /返回/u, 'Node 应识别返回命令');
    assert.match(nodeMain, /发送/u, 'Node 应识别发送命令');
    assert.match(nodeMain, /结束输入/u, 'Node 应识别结束输入命令');
    assert.match(nodeMain, /textInputHistory/u, 'Node 应保存可返回的语音输入记录');
});

test('发送只提交 Enter，不退出输入模式，并支持 30 秒无操作退出', () => {
    const sendStart = nodeMain.indexOf('async sendTextInput()');
    const sendEnd = nodeMain.indexOf('async startWindowsTextInput()', sendStart);
    const sendSource = nodeMain.slice(sendStart, sendEnd);

    assert.doesNotMatch(sendSource, /exitTextInputMode\(/u, '发送成功后不应立即退出输入模式');
    assert.match(sendSource, /textInputHistory\s*=\s*\[\]/u, '发送成功后应清空已发送文本的返回记录');
    assert.match(nodeMain, /TEXT_INPUT_IDLE_TIMEOUT_MS\s*=\s*30\s*\*\s*1000/u, '输入模式应使用 30 秒无操作超时');
    assert.match(nodeMain, /exitTextInputMode\(['"]30秒无输入['"],\s*true\)/u, '超时退出应播报结束提示');
    assert.match(nodeMain, /clearTextInputIdleTimer/u, '退出输入模式时应清理超时计时器');
});

test('输入模式声纹策略只在子显示端本地切换', () => {
    assert.ok(
        nodeConfig.textInput?.requireVoiceprint === 'inherit' || nodeConfig.textInput?.requireVoiceprint === false,
        '本地策略持久化值只能是 inherit 或 false'
    );
    assert.match(nodeMain, /TEXT_INPUT_VOICEPRINT_POLICY_DISABLED\s*=\s*false/u, '本地关闭策略应使用布尔 false');
    assert.match(nodeMain, /requireVoiceprint/u, 'Node 应读取本地输入模式声纹策略');
    assert.match(nodeMain, /inherit/u, 'Node 应支持 inherit 策略');
    assert.match(nodeMain, /WINDOWS_VOICEPRINT_HOTKEY_LABEL/u, 'Node 应注册声纹策略快捷键');
    assert.match(nodeMain, /toggleTextInputVoiceprintPolicy/u, 'Node 应提供声纹策略切换入口');
    assert.match(nodeMain, /voiceprintConfig.*enabled|serverVoiceprintEnabled/u, 'inherit 应使用服务器 voiceprint.enabled');
    assert.match(nodeInput, /Alt\+C/u, 'Windows 快捷键模块应支持 Alt+C');

    const toggleStart = nodeMain.lastIndexOf('toggleTextInputVoiceprintPolicy()');
    const toggleEnd = nodeMain.indexOf('\n    onToggleTextInputMode()', toggleStart);
    assert.ok(toggleStart >= 0 && toggleEnd > toggleStart, '应存在本地声纹策略切换实现');
    assert.doesNotMatch(
        nodeMain.slice(toggleStart, toggleEnd),
        /requestTextInputAnnouncement\(/u,
        'Alt+C 切换本地策略不应播报或暂停录音'
    );
});

test('输入模式声纹未匹配时不注入文字或执行语音命令', () => {
    assert.match(nodeMain, /isTextInputVoiceprintRequired/u, 'Node 应计算输入模式是否要求声纹');
    assert.match(nodeMain, /speaker/u, 'Node 应按 ASR 返回的 speaker 判断匹配结果');
    assert.match(nodeMain, /未通过声纹匹配/u, '声纹未匹配时应记录忽略原因');
});

test('Node 子显示端处理服务端录音协议消息', () => {
    assert.match(nodeMain, /case 'voiceRecordingConfig'/u, 'Node 应处理 voiceRecordingConfig');
    assert.match(nodeMain, /case 'displayRecordingRequest'/u, 'Node 应处理 displayRecordingRequest');
    assert.match(nodeMain, /displayRecordingResult/u, '暂不支持的临时录音请求应回传明确结果');
});

test('Node 子显示端不再把回退作为语音输入命令', () => {
    assert.match(nodeMain, /isTextInputCommand\(text, '返回'\)/u, '语音输入应使用返回命令');
    assert.doesNotMatch(nodeMain, /isTextInputCommand\(text, '回退'\)/u, '旧回退命令不应继续生效');
});

test('开始和结束输入通过提示播报控制录音时序', () => {
    assert.match(nodeMain, /已开始输入/u, 'Node 应播报开始输入提示');
    assert.match(nodeMain, /已结束输入/u, 'Node 应播报结束输入提示');
    assert.match(nodeMain, /textInputAnnouncement/u, 'Node 应维护提示播报状态');
    assert.match(nodeMain, /暂停录音/u, '提示播报前应暂停录音');
    assert.match(nodeMain, /恢复录音/u, '提示播报后应恢复录音');
    assert.match(audioPlayer, /onComplete/u, '音频队列应支持单项完成回调');
});

test('Node ASR 请求携带本地 Windows 输入标记', () => {
    assert.match(nodeClient, /textInputClient/u, 'ASR 请求应标记本地文本输入客户端');
    assert.match(nodeClient, /localTextInputMode/u, 'ASR 请求应携带本地输入模式');
    assert.match(nodeClient, /localTextInputRequireVoiceprint/u, '输入模式 ASR 请求应携带有效声纹策略');
    assert.match(nodeMain, /localTextInputRequireVoiceprint/u, 'Node 应按本地策略计算请求级声纹开关');
});

test('服务端对本地输入激活词和输入模式执行 ASR 旁路', () => {
    assert.match(server, /textInputClient/u, '服务端应识别本地文本输入客户端');
    assert.match(server, /localTextInputMode/u, '服务端应识别本地文本输入模式');
    assert.match(server, /localTextInputAction/u, '服务端应返回本地文本输入动作');
    assert.match(server, /开始输入/u, '服务端应处理开始输入激活词');
    assert.match(server, /textInputAnnouncement/u, '服务端应处理本地输入提示播报请求');
    assert.match(server, /textInputAnnouncementError/u, '服务端应回传提示播报错误');
    assert.match(server, /localTextInputRequireVoiceprint/u, '服务端应解析请求级声纹策略');
    assert.match(server, /useVoiceprint/u, '服务端转发显示端 ASR 时应携带请求级声纹开关');

    const asrRouteStart = server.indexOf("app.post('/api/asr/recognize'");
    const asrRoute = server.slice(asrRouteStart, server.indexOf("app.get('/api/config'", asrRouteStart));
    assert.match(asrRoute, /createLocalTextInputResponse/u, 'ASR 路由应计算本地输入动作');
    assert.match(asrRoute, /return res\.json/u, '本地输入模式应在服务端语音命令链路前返回');
    assert.match(asrRoute, /processRecognizedAsrResultForDisplay/u, '普通请求仍应进入原有服务端处理链路');
});

test('输入模式关闭声纹时，显示端 ASR 应跳过声纹耗时计算', () => {
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    const nativeBridge = read('src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');

    assert.match(display, /data\.useVoiceprint/u, '显示端应读取服务端下发的请求级声纹开关');
    assert.match(display, /data\.useVoiceprint\s*===\s*false/u, 'false 应覆盖显示端全局声纹配置');
    assert.match(
        nativeBridge,
        /if\s*\(!useVoiceprint[\s\S]*?voiceprintElapsedMs.*JSONObject\.NULL/u,
        '关闭声纹时原生桥应不执行匹配并返回空耗时'
    );
});

test('状态提示不创建全局 TTS 播放门控，避免 Node 录音无法恢复', () => {
    const prepareStart = server.indexOf('function prepareVoiceTtsPlayback');
    const prepareEnd = server.indexOf('let displayListDebounceTimer', prepareStart);
    const prepareSource = server.slice(prepareStart, prepareEnd);

    assert.match(
        prepareSource,
        /if\s*\(data\.textInputAnnouncementId\)\s*return;/u,
        '本地状态提示不应进入全局 voiceTtsPlayback 状态'
    );
});
