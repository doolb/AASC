'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
    hasReleaseFlag,
    resolveReleaseRuntimeContext
} = require('../src/core/release-runtime-context');

test('没有 --release 时保留开发配置、用户配置和任务路径', () => {
    const context = resolveReleaseRuntimeContext({
        projectRoot: '/workspace/aasc',
        homeDir: '/home/tester',
        argv: ['node', 'server-launcher.js'],
        environment: {}
    });

    assert.deepEqual(context, {
        releaseMode: false,
        configFile: '/workspace/aasc/config/config.json',
        userConfigDir: '/home/tester/.config/aasc-user',
        taskDir: '/workspace/aasc/res/tasks'
    });
});

test('--release 和 AASC_RELEASE_MODE 都切换到 release 路径', () => {
    const byFlag = resolveReleaseRuntimeContext({
        projectRoot: '/workspace/aasc',
        homeDir: '/home/tester',
        argv: ['node', 'server-launcher.js', '--release'],
        environment: {}
    });
    const byEnvironment = resolveReleaseRuntimeContext({
        projectRoot: '/workspace/aasc',
        homeDir: '/home/tester',
        argv: ['node', 'server-app.js'],
        environment: { AASC_RELEASE_MODE: '1' }
    });

    assert.equal(byFlag.releaseMode, true);
    assert.equal(byFlag.configFile, '/workspace/aasc/release/config/config.json');
    assert.equal(byFlag.userConfigDir, '/workspace/aasc/release/userconfig');
    assert.equal(byFlag.taskDir, '/workspace/aasc/release/task');
    assert.deepEqual(byEnvironment, byFlag);
});

test('只识别完整的 --release 参数', () => {
    assert.equal(hasReleaseFlag(['node', 'server-app.js', '--release']), true);
    assert.equal(hasReleaseFlag(['node', 'server-app.js', '--release=true']), false);
    assert.equal(hasReleaseFlag(['node', 'server-app.js', '--release-mode']), false);
});
