'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createShareFoldersService } = require('../src/apps/server/modules/media/share-folders-service');

test('分类文件夹按类型隔离、可移动链接并持久化广播，不能删除非空目录', () => {
    const saved = {};
    const broadcasts = [];
    const messages = [];
    const config = { get: (key, fallback) => saved[key] ?? fallback, set: (key, value) => { saved[key] = value; } };
    const service = createShareFoldersService({ config, broadcast: message => broadcasts.push(message) });
    const ws = { send: value => messages.push(JSON.parse(value)) };
    service.handle(ws, { type: 'shareFolderCreate', category: 'quark', name: '电影' });
    const id = broadcasts.at(-1).folders.quark.folders[0].id;
    service.handle(ws, { type: 'shareFolderMove', category: 'quark', key: 'server::library', folderId: id });
    assert.equal(broadcasts.at(-1).folders.quark.entries['server::library'], id);
    assert.deepEqual(broadcasts.at(-1).folders.bilibili.folders, []);
    service.handle(ws, { type: 'shareFolderDelete', category: 'quark', folderId: id });
    assert.match(messages.at(-1).message, /先移出/);
    service.handle(ws, { type: 'shareFolderMove', category: 'quark', key: 'server::library', folderId: '' });
    service.handle(ws, { type: 'shareFolderDelete', category: 'quark', folderId: id });
    service.handle(ws, { type: 'shareFoldersGet' });
    assert.deepEqual(messages.at(-1).folders.quark.folders, []);
    assert.deepEqual(saved['media.shareFolders'].quark.entries, {});
});

test('夸克 Cookie 保存后仅广播配置状态，快照不包含凭据', () => {
    const saved = {};
    const sent = [];
    const config = { get: (key, fallback) => saved[key] ?? fallback, set: (key, value) => { saved[key] = value; } };
    const service = createShareFoldersService({ config, broadcast: message => sent.push(message) });
    const ws = { send: value => sent.push(JSON.parse(value)) };
    service.handle(ws, { type: 'quarkCookieSet', cookie: '__pus=private-test-value' });
    assert.equal(saved['media.quarkCookie'], '__pus=private-test-value');
    assert.equal(sent.at(-1).quarkCookieConfigured, true);
    assert.doesNotMatch(JSON.stringify(sent), /private-test-value/);
    service.handle(ws, { type: 'quarkCookieSet', cookie: 'invalid\nheader' });
    assert.match(sent.at(-1).message, /格式无效/);
    assert.equal(saved['media.quarkCookie'], '__pus=private-test-value');
});

test('B站 Cookie 仅保存并广播配置状态', () => {
    const saved = {}, sent = [];
    const service = createShareFoldersService({ config: { get: (key, fallback) => saved[key] ?? fallback, set: (key, value) => { saved[key] = value; return true; } }, broadcast: value => sent.push(value) });
    service.handle({ send: () => {} }, { type: 'bilibiliCookieSet', cookie: 'SESSDATA=secret' });
    assert.equal(saved['media.bilibiliCookie'], 'SESSDATA=secret');
    assert.equal(sent[0].bilibiliCookieConfigured, true);
    assert.doesNotMatch(JSON.stringify(sent), /SESSDATA/);
});
