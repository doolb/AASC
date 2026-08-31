'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createPublicRepairModeConfig,
    updateRepairModeConfig
} = require('../src/apps/server/modules/voice/repair-mode-config');

const roles = [
    { name: 'mainfront', running: true },
    { name: '工作Agent', running: false }
];

test('修复模式配置读取只暴露密码状态和角色列表', () => {
    const result = createPublicRepairModeConfig({ password: '青灯守门', role: 'mainfront' }, roles);

    assert.deepEqual(result, {
        passwordConfigured: true,
        role: 'mainfront',
        roles: ['mainfront', '工作Agent']
    });
    assert.equal(Object.hasOwn(result, 'password'), false);
});

test('修复模式配置留空密码时保留旧密码并更新合法角色', () => {
    const result = updateRepairModeConfig({
        body: { password: '', role: '工作Agent' },
        currentConfig: { password: '旧密码', role: 'mainfront' },
        roles
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { password: '旧密码', role: '工作Agent' });
});

test('修复模式配置明确清空密码后进入功能停用状态', () => {
    const result = updateRepairModeConfig({
        body: { clearPassword: true, role: 'mainfront' },
        currentConfig: { password: '旧密码', role: 'mainfront' },
        roles
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { password: '', role: 'mainfront' });
    assert.equal(result.publicConfig.passwordConfigured, false);
});

test('修复模式配置拒绝不存在的工作 Agent', () => {
    const result = updateRepairModeConfig({
        body: { password: '新密码', role: '不存在' },
        currentConfig: { password: '旧密码', role: 'mainfront' },
        roles
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /Agent|角色/);
});
