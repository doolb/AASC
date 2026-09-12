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
});

test('服务端对本地输入激活词和输入模式执行 ASR 旁路', () => {
    assert.match(server, /textInputClient/u, '服务端应识别本地文本输入客户端');
    assert.match(server, /localTextInputMode/u, '服务端应识别本地文本输入模式');
    assert.match(server, /localTextInputAction/u, '服务端应返回本地文本输入动作');
    assert.match(server, /开始输入/u, '服务端应处理开始输入激活词');
    assert.match(server, /textInputAnnouncement/u, '服务端应处理本地输入提示播报请求');
    assert.match(server, /textInputAnnouncementError/u, '服务端应回传提示播报错误');

    const asrRouteStart = server.indexOf("app.post('/api/asr/recognize'");
    const asrRoute = server.slice(asrRouteStart, server.indexOf("app.get('/api/config'", asrRouteStart));
    assert.match(asrRoute, /createLocalTextInputResponse/u, 'ASR 路由应计算本地输入动作');
    assert.match(asrRoute, /return res\.json/u, '本地输入模式应在服务端语音命令链路前返回');
    assert.match(asrRoute, /processRecognizedAsrResultForDisplay/u, '普通请求仍应进入原有服务端处理链路');
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
