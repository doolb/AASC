'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTaskMediaCollections } = require('../src/apps/server/modules/media/task-media-collections');

test('来源收藏分类持久化、隔离、移动并广播，非空目录不能删除', () => {
    const data = {}, sent = [], broadcasts = [];
    const config = { get: (key, fallback) => data[key] ?? fallback, set: (key, value) => { data[key] = value; return true; } };
    const service = createTaskMediaCollections({ config, broadcast: item => broadcasts.push(item) });
    const ws = { send: value => sent.push(JSON.parse(value)) };
    service.handle(ws, { type: 'taskMediaFolderCreate', sourceId: 'hongguo', name: '短剧' });
    const folderId = broadcasts.at(-1).sources.hongguo.folders[0].id;
    service.handle(ws, { type: 'taskMediaAdd', sourceId: 'hongguo', url: 'https://hongguoduanju.com/player/123', title: '剧集', folderId });
    service.handle(ws, { type: 'taskMediaAdd', sourceId: 'tomato', url: '12345', title: '小说' });
    assert.equal(broadcasts.at(-1).sources.hongguo.items[0].folderId, folderId);
    assert.equal(broadcasts.at(-1).sources.tomato.items[0].url, '12345');
    service.handle(ws, { type: 'taskMediaFolderDelete', sourceId: 'hongguo', folderId });
    assert.match(sent.at(-1).message, /先移出/);
    service.handle(ws, { type: 'taskMediaMove', sourceId: 'hongguo', url: 'https://hongguoduanju.com/player/123', folderId: '' });
    service.handle(ws, { type: 'taskMediaFolderDelete', sourceId: 'hongguo', folderId });
    service.handle(ws, { type: 'taskMediaRemove', sourceId: 'hongguo', url: 'https://hongguoduanju.com/player/123' });
    service.handle(ws, { type: 'taskMediaCollectionsGet' });
    assert.deepEqual(sent.at(-1).sources.hongguo, { folders: [], items: [] });
    assert.equal(sent.at(-1).sources.tomato.items.length, 1);
    assert.deepEqual(createTaskMediaCollections({ config, broadcast: () => {} }).snapshot(), sent.at(-1));
});

test('拒绝非法来源、凭据链接和不存在的目标且不写配置', () => {
    const data = {}, sent = [];
    const service = createTaskMediaCollections({ config: { get: (key, fallback) => data[key] ?? fallback, set: (key, value) => { data[key] = value; return true; } }, broadcast: () => {} });
    const ws = { send: value => sent.push(JSON.parse(value)) };
    for (const payload of [
        { type: 'taskMediaAdd', sourceId: '__proto__', url: '123' },
        { type: 'taskMediaAdd', sourceId: 'youtube', url: 'https://name:secret@example.org/' },
        { type: 'taskMediaAdd', sourceId: 'youtube', url: 'https://example.org/?token=secret' },
        { type: 'taskMediaAdd', sourceId: 'youtube', url: '123', folderId: 'missing' }
    ]) service.handle(ws, payload);
    assert.equal(sent.length, 4);
    assert.ok(sent.every(message => message.type === 'taskMediaCollectionsError'));
    assert.deepEqual(data, {});
    assert.doesNotMatch(JSON.stringify(sent), /secret/);
});

test('加入只在保存成功后确认，拒绝时返回同一请求的错误', () => {
    let writeOk = false; const sent = [], broadcasts = [];
    const service = createTaskMediaCollections({ config: { get: (_key, fallback) => fallback, set: () => writeOk }, broadcast: value => broadcasts.push(value) });
    const ws = { send: value => sent.push(JSON.parse(value)) };
    const payload = { type: 'taskMediaAdd', requestId: 'add-123', sourceId: 'pixiv', url: '123' };
    service.handle(ws, payload);
    assert.equal(sent[0].status, 'error'); assert.equal(sent[0].requestId, payload.requestId); assert.equal(broadcasts.length, 0);
    writeOk = true; service.handle(ws, payload);
    assert.deepEqual(sent[1], { type: 'taskMediaAddResult', requestId: 'add-123', status: 'success' }); assert.equal(broadcasts.length, 1);
});
