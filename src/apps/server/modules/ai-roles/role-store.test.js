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
    assert.strictEqual(role.name, '后端助手');
    assert.ok(typeof role.createdAt === 'number', 'createdAt 应为时间戳数字');
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

// 角色名来自前端用户输入，必须拒绝路径穿越/嵌套名，防止目录逃逸与递归删除父目录
test('角色名拒绝路径穿越与嵌套（add/remove/exists/loadHistory/appendHistory）', () => {
    const base = tmpBase();
    const store = new RoleStore(base);
    // 嵌套名：会建目录树
    assert.throws(() => store.add('a/b'), /角色名不合法/);
    assert.throws(() => store.add('a\\b'), /角色名不合法/);
    // 目录穿越名：add('..') 会在父级建目录、remove('..') 会递归删除父目录
    assert.throws(() => store.add('..'), /角色名不合法/);
    assert.throws(() => store.add('.'), /角色名不合法/);
    // 所有会触碰路径的入口都要防御
    assert.throws(() => store.remove('..'), /角色名不合法/);
    assert.throws(() => store.exists('a/b'), /角色名不合法/);
    assert.throws(() => store.loadHistory('..'), /角色名不合法/);
    assert.throws(() => store.appendHistory('a/b', { role: 'user', name: '用户', content: 'hi' }), /角色名不合法/);
    // 破坏性验证 remove 安全：remove('..') 抛错后，baseDir 及其父级必须原样保留
    assert.ok(fs.existsSync(base), 'baseDir 应仍存在');
    assert.ok(fs.existsSync(path.dirname(base)), 'baseDir 父级应仍存在');
});

// 损坏的 history.json 不能被静默覆盖——应改名保留（可恢复），下次写入重新创建
test('损坏 history.json 改名保留后重新写入，不覆盖丢数据', () => {
    const base = tmpBase();
    const store = new RoleStore(base);
    store.add('前端');
    // 手工写入非法 JSON，模拟历史文件损坏
    const histDir = path.join(base, '前端');
    fs.writeFileSync(path.join(histDir, 'history.json'), '{ 这不是合法 JSON');
    // 读取时返回空数组，但原损坏文件被改名 history.json.corrupt-<时间戳> 保留
    assert.deepStrictEqual(store.loadHistory('前端'), []);
    const corrupts = fs.readdirSync(histDir).filter((f) => f.startsWith('history.json.corrupt-'));
    assert.strictEqual(corrupts.length, 1, '应保留一个 .corrupt 备份');
    assert.ok(!fs.existsSync(path.join(histDir, 'history.json')), '原损坏文件应已被改名');
    // 再次 append：新 history.json 重新创建，历史不丢失（损坏原文件仍在备份中）
    store.appendHistory('前端', { role: 'user', name: '用户', content: 'hi' });
    const hist = store.loadHistory('前端');
    assert.strictEqual(hist.length, 1);
    assert.strictEqual(hist[0].content, 'hi');
    // 备份文件与新的正常 history.json 同时存在
    assert.ok(fs.existsSync(path.join(histDir, 'history.json')), '新 history.json 应已重建');
    assert.strictEqual(fs.readdirSync(histDir).filter((f) => f.startsWith('history.json.corrupt-')).length, 1);
});
