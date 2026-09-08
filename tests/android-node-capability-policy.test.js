'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
