'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createRepairModeState,
    beginRepairModeEntry,
    verifyRepairModePassword,
    handleRepairModeInput
} = require('../src/apps/server/modules/voice/repair-mode');

test('修复模式使用中文明文密码进入并记录配置角色', () => {
    const result = beginRepairModeEntry(createRepairModeState(), {
        passwordConfigured: true,
        role: 'mainfront',
        now: 1000,
        passwordTimeoutMs: 30000
    });

    assert.equal(result.event.type, 'passwordRequired');
    assert.equal(result.state.state, 'awaitingPassword');
    assert.equal(result.state.role, 'mainfront');

    const verified = verifyRepairModePassword(result.state, '维修模式', '维修模式', {
        now: 2000,
        sessionTimeoutMs: 180000
    });
    assert.equal(verified.event.type, 'entered');
    assert.equal(verified.state.state, 'active');
    assert.equal(verified.state.expiresAt, 182000);
});

test('错误密码不会进入修复模式且结果不返回密码', () => {
    const waiting = beginRepairModeEntry(createRepairModeState(), {
        passwordConfigured: true,
        role: 'mainfront',
        now: 1000,
        passwordTimeoutMs: 30000
    });
    const result = verifyRepairModePassword(waiting.state, '错误密码', '维修模式', { now: 2000 });

    assert.equal(result.event.type, 'passwordRejected');
    assert.equal(result.state.state, 'inactive');
    assert.equal(JSON.stringify(result), JSON.stringify({
        state: { state: 'inactive', role: null, pendingText: null, expiresAt: null },
        event: { type: 'passwordRejected' }
    }));
});

test('修复请求必须先确认，取消不会提交原文', () => {
    const active = {
        state: 'active',
        role: 'mainfront',
        pendingText: null,
        expiresAt: 100000
    };
    const pending = handleRepairModeInput(active, '请检查服务器启动问题', 3000);
    assert.deepEqual(pending.event, {
        type: 'confirmationRequired',
        text: '请检查服务器启动问题'
    });

    const cancelled = handleRepairModeInput(pending.state, '取消', 4000);
    assert.deepEqual(cancelled.event, { type: 'cancelled' });
    assert.equal(cancelled.state.pendingText, null);
});

test('确认返回配置角色和原始请求，退出优先清理状态', () => {
    const state = {
        state: 'active',
        role: 'repair-worker',
        pendingText: '请修复启动问题',
        expiresAt: 100000
    };
    const confirmed = handleRepairModeInput(state, '确认。', 5000);
    assert.deepEqual(confirmed.event, {
        type: 'confirmed',
        role: 'repair-worker',
        text: '请修复启动问题'
    });
    assert.equal(confirmed.state.pendingText, null);

    const exited = handleRepairModeInput(confirmed.state, '退出修复模式', 6000);
    assert.deepEqual(exited.event, { type: 'exited' });
    assert.equal(exited.state.state, 'inactive');
});
