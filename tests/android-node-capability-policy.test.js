'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
    createAndroidCapabilityUnavailableError,
    getAndroidNodePolicy
} = require('../src/apps/server/modules/runtime/android-node-capability-policy');

test('Android 节点只声明不依赖额外进程的能力', () => {
    const policy = getAndroidNodePolicy({ AASC_ANDROID_NODE: '1' });

    assert.equal(policy.enabled, true);
    assert.deepEqual(policy.capabilities, {
        mediaLibrary: true,
        displayGateway: true,
        hotUpdate: true
    });
    assert.deepEqual(policy.disabledFeatures, [
        'asr',
        'tts',
        'puppeteer',
        'externalCli',
        'taskRuntime'
    ]);
});

test('普通服务器不受 Android 节点策略影响', () => {
    const policy = getAndroidNodePolicy({ AASC_ANDROID_NODE: '0' });

    assert.equal(policy.enabled, false);
    assert.deepEqual(policy.capabilities, null);
    assert.deepEqual(policy.disabledFeatures, []);
});

test('禁用能力返回结构化 Android 节点错误', () => {
    const error = createAndroidCapabilityUnavailableError('puppeteer');

    assert.equal(error.code, 'androidCapabilityUnavailable');
    assert.match(error.message, /Android APK 节点不支持.*puppeteer/u);
});

test('服务器入口读取 Android 节点策略并按策略初始化语音服务', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../src/apps/server/boot/server-app.js'),
        'utf8'
    );

    assert.match(source, /getAndroidNodePolicy/u);
    assert.match(source, /ANDROID_NODE_POLICY/u);
    assert.match(source, /ANDROID_NODE_POLICY\.enabled/u);
});

test('Android 节点不构造可选任务子进程 runner', () => {
    const TaskManager = require('../src/apps/server/modules/task-engine/task-manager');
    const manager = new TaskManager({ serverExecutionDisabled: true });

    assert.equal(manager.nodeRunner, null);
    assert.equal(manager.puppeteerRunner, null);
});

test('Android 节点禁止恢复和启动外部 Agent 进程', async () => {
    const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-android-agent-test-'));
    try {
        const AiRolesService = require('../src/apps/server/modules/ai-roles/ai-roles-service');
        const service = new AiRolesService({
            baseDir,
            projectRoot: path.resolve(__dirname, '..'),
            disabled: true
        });
        service.add('apk-test-role');

        await assert.rejects(
            () => service.chat('apk-test-role', '不应启动外部 Agent'),
            /Android APK 节点不支持.*externalCli/u
        );
        assert.equal((await service.restoreAll()).every(role => role.running === false), true);
    } finally {
        await fs.promises.rm(baseDir, { recursive: true, force: true });
    }
});

test('Android 节点禁止启动普通聊天 Codex 子进程', async () => {
    const { CodexRuntimeManager } = require('../src/apps/server/modules/chat/codex-runtime-manager');
    const manager = new CodexRuntimeManager({ disabled: true });

    await assert.rejects(
        () => manager.chatStream({}, {}, '不应启动 Codex'),
        /Android APK 节点不支持.*externalCli/u
    );
});
