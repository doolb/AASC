'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const RoleStore = require('./role-store');

function tmpBase() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'role-store-'));
}

test('add/list/exists/remove 往返', () => {
    const store = new RoleStore(tmpBase());
    const role = store.add('后端助手');
    assert.deepStrictEqual(role, { name: '后端助手', createdAt: role.createdAt });
    assert.ok(store.exists('后端助手'));
    assert.deepStrictEqual(store.list(), [role]);
    store.remove('后端助手');
    assert.ok(!store.exists('后端助手'));
    assert.deepStrictEqual(store.list(), []);
});

test('重名/空名抛错', () => {
    const store = new RoleStore(tmpBase());
    store.add('a');
    assert.throws(() => store.add('a'), /已存在/);
    assert.throws(() => store.add('  '), /不能为空/);
});

test('appendHistory/loadHistory 往返且持久', () => {
    const base = tmpBase();
    const store = new RoleStore(base);
    store.add('前端');
    store.appendHistory('前端', { role: 'control', name: '用户', content: 'hi', mode: 'role', target: '前端' });
    const hist = store.appendHistory('前端', { role: 'assistant', name: '前端', content: 'hello', mode: 'role', target: '前端' });
    assert.strictEqual(hist.length, 2);
    // 重新实例化（模拟服务器重启）后历史仍在
    const store2 = new RoleStore(base);
    assert.strictEqual(store2.loadHistory('前端').length, 2);
    assert.strictEqual(store2.loadHistory('前端')[1].content, 'hello');
});

test('不存在角色 history 返回空数组', () => {
    const store = new RoleStore(tmpBase());
    assert.deepStrictEqual(store.loadHistory('nobody'), []);
});

test('roleDir 返回角色目录绝对路径', () => {
    const base = tmpBase();
    const store = new RoleStore(base);
    assert.strictEqual(store.roleDir('a'), path.join(base, 'a'));
});
