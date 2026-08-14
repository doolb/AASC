'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { PlaylistManager } = require('../src/apps/web-mediacenter/modules/media/playlist-app-service.js');

// 假媒体库管理器：内存目录树
const tree = {
    '/': [
        { name: 'b.mp4', path: '/b.mp4', type: 'file', mediaType: 'video', modifiedTime: new Date('2026-01-02'), url: '/media/1/b.mp4' },
        { name: 'readme.txt', path: '/readme.txt', type: 'file', mediaType: 'text', modifiedTime: new Date('2026-01-02'), url: '/media/1/readme.txt' },
        { name: '相册', path: '/相册', type: 'folder', mediaType: 'folder' }
    ],
    '/相册': [
        { name: 'a.jpg', path: '/相册/a.jpg', type: 'file', mediaType: 'image', modifiedTime: new Date('2026-01-01'), url: '/media/1/a.jpg' },
        { name: 'c.gif', path: '/相册/c.gif', type: 'file', mediaType: 'gif', modifiedTime: new Date('2026-01-03'), url: '/media/1/c.gif' },
        { name: '子', path: '/相册/子', type: 'folder', mediaType: 'folder' }
    ],
    '/相册/子': [
        { name: 'd.jpg', path: '/相册/子/d.jpg', type: 'file', mediaType: 'image', modifiedTime: new Date('2026-01-04'), url: '/media/1/d.jpg' }
    ]
};

const fakeManager = {
    async list(libraryId, path) {
        return tree[path] || [];
    }
};

test('buildFromLibrary 单层只收集当前层媒体并过滤非媒体', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/', { recursive: false, mode: 'sequence', sortBy: 'name', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['b.mp4']);
    assert.strictEqual(list[0].url, '/media/1/b.mp4');
});

test('buildFromLibrary 递归收集全部层级媒体', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/', { recursive: true, mode: 'sequence', sortBy: 'name', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['a.jpg', 'b.mp4', 'c.gif', 'd.jpg']);
});

test('buildFromLibrary 按时间正序', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/相册', { recursive: true, mode: 'sequence', sortBy: 'time', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['a.jpg', 'c.gif', 'd.jpg']);
});

test('buildFromLibrary 按时间反序', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/相册', { recursive: true, mode: 'sequence', sortBy: 'time', direction: 'desc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['d.jpg', 'c.gif', 'a.jpg']);
});

test('buildFromLibrary 随机模式洗牌包含全部项且不重复', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/相册', { recursive: true, mode: 'random' });
    const names = list.map(i => i.fileName).sort();
    assert.deepStrictEqual(names, ['a.jpg', 'c.gif', 'd.jpg']);
});

test('buildFromTemp 按文件名排序并保留 data', () => {
    const pm = new PlaylistManager(fakeManager);
    const files = [
        { name: 'b.png', data: 'BBB', mediaType: 'image', mimeType: 'image/png' },
        { name: 'a.png', data: 'AAA', mediaType: 'image', mimeType: 'image/png' }
    ];
    const list = pm.buildFromTemp(files, { mode: 'sequence', sortBy: 'name', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['a.png', 'b.png']);
    assert.strictEqual(list[0].data, 'AAA');
    assert.strictEqual(list[0].mimeType, 'image/png');
});
