'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildManualChatVoiceConversationUpdates,
    createConversationState
} = require('../src/apps/server/modules/voice/display-voice-conversation');

const projectRoot = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(projectRoot, 'src/apps/server/boot/server-app.js'), 'utf8');
const restoreSource = server.slice(server.indexOf('function restoreOfflineChatSelection('),
    server.indexOf('function syncDisplayConversationListeningState('));
const connectStart = server.indexOf("        syncDisplayConversationListeningState(displayId, 'connect');");
const connectSource = server.slice(connectStart, server.indexOf("        log('连接'", connectStart));

function runConnection({ offlineMode = true, session = { mode: 'private', privateTarget: '妲己' },
    enabled = true, conversation = createConversationState(true) } = {}) {
    const calls = [];
    const display = { state: { voiceConversation: conversation, chatLayerVisible: false, voiceContinuousEnabled: false } };
    const context = vm.createContext({
        OFFLINE_NODE_MODE: offlineMode, displayClients: new Map([['offline-local', display]]),
        displayId: 'offline-local', chat: { getSession: () => session },
        buildManualChatVoiceConversationUpdates,
        isDisplayVoiceListeningEnabled: () => enabled,
        syncDisplayConversationListeningState: (_id, reason) => calls.push(['sync', reason]),
        armDisplayConversationTimer: (id, options) => calls.push(['arm', id, options.reason])
    });
    // 执行真实连接调用片段和恢复函数，计时器只记录调用，不创建常驻测试资源。
    vm.runInContext(restoreSource + connectSource, context);
    return { calls, display };
}

test('Offline新连接恢复持久化私聊并启动现有计时，面板与监听开关保持关闭', () => {
    const { calls, display } = runConnection();
    assert.deepEqual(calls, [['sync', 'connect'], ['arm', 'offline-local', 'offlineChatRestored']]);
    assert.equal(display.state.voiceConversation.state, 'activePrivate');
    assert.equal(display.state.voiceConversation.target, '妲己');
    assert.equal(display.state.chatLayerVisible, false);
    assert.equal(display.state.voiceContinuousEnabled, false);
});

test('普通部署、禁用录音、默认群聊、角色及无效私聊不自动建立连接语音会话', () => {
    for (const options of [
        { offlineMode: false }, { enabled: false },
        { session: { mode: 'group' } }, { session: { mode: 'role', roleTarget: '工作助手' } },
        { session: { mode: 'temporary' } }, { session: { mode: 'private', privateTarget: '  ' } }
    ]) {
        const { calls, display } = runConnection(options);
        assert.deepEqual(calls, [['sync', 'connect']]);
        assert.equal(display.state.voiceConversation.state, 'waitingWake');
    }
});

test('连接恢复不覆盖活跃、禁用或临时会话，不重新开始其计时', () => {
    for (const state of ['activePrivate', 'activeGroup', 'disabled']) {
        const conversation = { ...createConversationState(true), state, target: '旧对象', windowType: 'temporary' };
        const { calls, display } = runConnection({ conversation });
        assert.deepEqual(calls, [['sync', 'connect']]);
        assert.equal(display.state.voiceConversation, conversation);
    }
});

test('连接恢复来源仅允许Offline有效私聊，其他同步来源和旧手动规则独立', () => {
    const options = { offlineMode: true, source: 'offlineRestore',
        chatSession: { mode: 'private', privateTarget: ' 小爱 ' },
        displays: [{ displayId: 'local', voiceRecordingEnabled: true }, { displayId: 'muted', voiceRecordingEnabled: false }], now: 100 };
    const updates = buildManualChatVoiceConversationUpdates(options);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].conversation.target, '小爱');
    assert.equal(updates[0].conversation.lastValidInputAt, 100);
    assert.deepEqual(buildManualChatVoiceConversationUpdates({ ...options, source: 'serverSync' }), []);
    assert.deepEqual(buildManualChatVoiceConversationUpdates({ ...options, offlineMode: false }), []);
    assert.deepEqual(buildManualChatVoiceConversationUpdates({ ...options, chatSession: { mode: 'group' } }), []);
});

test('隔离的真实会话存储在服务进程重启后恢复私聊、会话ID及工作角色', (context) => {
    const cache = path.join(os.homedir(), '.cache/aasc-chat-recovery-test');
    fs.mkdirSync(cache, { recursive: true });
    const isolatedRoot = fs.mkdtempSync(path.join(cache, 'session-'));
    context.after(() => fs.rmSync(isolatedRoot, { recursive: true, force: true }));
    for (const relative of ['release/config', 'release/userconfig', 'release/task']) {
        fs.mkdirSync(path.join(isolatedRoot, relative), { recursive: true });
    }
    fs.writeFileSync(path.join(isolatedRoot, 'release/config/config.json'), '{}');
    const servicePath = path.join(projectRoot, 'src/external/llm/llm-service.js');
    function runService(selection) {
        const script = `const chat = require(${JSON.stringify(servicePath)}); chat.init();
            ${selection ? `chat.setSession(${JSON.stringify(selection)}, { source: 'controlManual' });` : ''}
            console.log('RECOVERED_SESSION=' + JSON.stringify(chat.getSession()));`;
        const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 15000,
            cwd: projectRoot, env: { ...process.env, AASC_PROJECT_ROOT: isolatedRoot, AASC_RELEASE_MODE: '1' } });
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        const line = result.stdout.split('\n').find((item) => item.startsWith('RECOVERED_SESSION='));
        assert.ok(line, result.stdout);
        return JSON.parse(line.slice('RECOVERED_SESSION='.length));
    }
    for (const selection of [
        { mode: 'role', roleTarget: '工作助手', privateTarget: null, privateSessionId: 'default' },
        { mode: 'private', roleTarget: null, privateTarget: '妲己', privateSessionId: 'session-2' },
        { mode: 'role', roleTarget: '  小爱工作  ', privateTarget: null, privateSessionId: 'default' }
    ]) {
        const written = runService(selection);
        const recovered = runService();
        for (const key of ['mode', 'roleTarget', 'privateTarget', 'privateSessionId']) {
            assert.equal(recovered[key], key === 'roleTarget' && selection[key] ? selection[key].trim() : selection[key]);
            assert.equal(recovered[key], written[key]);
        }
    }
    const cleared = runService({ roleTarget: 123 });
    assert.equal(cleared.roleTarget, null);
    assert.equal(runService().roleTarget, null);
});
