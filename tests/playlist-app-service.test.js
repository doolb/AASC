'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { PlaylistManager } = require('../src/apps/web-mediacenter/modules/media/playlist-app-service.js');

// 假媒体库管理器：内存目录树
const tree = {
    '/': [
        { name: 'b.mp4', path: '/b.mp4', type: 'file', mediaType: 'video', modifiedTime: new Date('2026-01-02'), url: '/media/1/b.mp4' },
        { name: 'readme.txt', path: '/readme.txt', type: 'file', mediaType: 'text', format: 'plain', modifiedTime: new Date('2026-01-02'), url: '/media/1/readme.txt' },
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

const htmlTree = {
    '/': [
        { name: 'index.html', path: '/index.html', type: 'file', mediaType: 'html', modifiedTime: new Date('2026-01-02'), url: '/media/1/index.html' },
        { name: 'a.jpg', path: '/a.jpg', type: 'file', mediaType: 'image', modifiedTime: new Date('2026-01-01'), url: '/media/1/a.jpg' }
    ]
};

const audioTree = {
    '/': [
        { name: 'voice.mp3', path: '/voice.mp3', type: 'file', mediaType: 'audio', modifiedTime: new Date('2026-01-01'), url: '/media/1/voice.mp3' },
        { name: 'sound.ogg', path: '/sound.ogg', type: 'file', mediaType: 'audio', modifiedTime: new Date('2026-01-02'), url: '/media/1/sound.ogg' }
    ]
};

const audioFakeManager = {
    async list(libraryId, path) {
        return audioTree[path] || [];
    }
};

const htmlFakeManager = {
    async list(libraryId, path) {
        return htmlTree[path] || [];
    }
};

test('buildFromLibrary 收集 html 媒体文件', async () => {
    const pm = new PlaylistManager(htmlFakeManager);
    const list = await pm.buildFromLibrary('lib1', '/', { recursive: false, mode: 'sequence', sortBy: 'name', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['a.jpg', 'index.html']);
    assert.strictEqual(list[1].mediaType, 'html');
});

test('buildFromLibrary 收集 audio 媒体文件', async () => {
    const pm = new PlaylistManager(audioFakeManager);
    const list = await pm.buildFromLibrary('lib1', '/', { recursive: false, mode: 'sequence', sortBy: 'name', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['sound.ogg', 'voice.mp3']);
    assert.deepStrictEqual(list.map(i => i.mediaType), ['audio', 'audio']);
});

test('buildFromLibrary 单层收集当前层全部媒体并过滤文件夹', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/', { recursive: false, mode: 'sequence', sortBy: 'name', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['b.mp4', 'readme.txt']);
    assert.strictEqual(list[0].url, '/media/1/b.mp4');
    assert.strictEqual(list[1].format, 'plain');
});

test('buildFromLibrary 递归收集全部层级媒体', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/', { recursive: true, mode: 'sequence', sortBy: 'name', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['a.jpg', 'b.mp4', 'c.gif', 'd.jpg', 'readme.txt']);
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

test('buildFromLibrary 按 mediaTypes 筛选并兼容 web/image 映射', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/', {
        recursive: true,
        mode: 'sequence',
        sortBy: 'name',
        direction: 'asc',
        mediaTypes: ['web', 'image']
    });

    assert.deepStrictEqual(list.map(i => [i.fileName, i.mediaType]), [
        ['a.jpg', 'image'],
        ['c.gif', 'gif'],
        ['d.jpg', 'image']
    ]);
});

test('buildFromLibrary mediaTypes 缺失、空数组或未知值时兼容旧客户端为全部类型', async () => {
    const pm = new PlaylistManager(fakeManager);

    const noTypes = await pm.buildFromLibrary('lib1', '/', {
        recursive: true,
        mode: 'sequence',
        sortBy: 'name',
        direction: 'asc'
    });
    const emptyTypes = await pm.buildFromLibrary('lib1', '/', {
        recursive: true,
        mode: 'sequence',
        sortBy: 'name',
        direction: 'asc',
        mediaTypes: []
    });
    const unknownTypes = await pm.buildFromLibrary('lib1', '/', {
        recursive: true,
        mode: 'sequence',
        sortBy: 'name',
        direction: 'asc',
        mediaTypes: ['unknown']
    });

    const expected = ['a.jpg', 'b.mp4', 'c.gif', 'd.jpg', 'readme.txt'];
    assert.deepStrictEqual(noTypes.map(i => i.fileName), expected);
    assert.deepStrictEqual(emptyTypes.map(i => i.fileName), expected);
    assert.deepStrictEqual(unknownTypes.map(i => i.fileName), expected);
});

test('buildFromTemp 按 mediaTypes 筛选并保留 text MIME/format', () => {
    const pm = new PlaylistManager(fakeManager);
    const files = [
        { name: 'page.html', data: 'HTML', mediaType: 'html', mimeType: 'text/html' },
        { name: 'photo.jpg', data: 'IMG', mediaType: 'image', mimeType: 'image/jpeg' },
        { name: 'anim.gif', data: 'GIF', mediaType: 'gif', mimeType: 'image/gif' },
        { name: 'note.txt', data: 'TXT', mediaType: 'text', mimeType: 'text/plain', format: 'plain' }
    ];

    const list = pm.buildFromTemp(files, {
        mode: 'sequence',
        sortBy: 'name',
        direction: 'asc',
        mediaTypes: ['web', 'text']
    });

    assert.deepStrictEqual(list, [
        {
            data: 'TXT',
            fileName: 'note.txt',
            mediaType: 'text',
            mimeType: 'text/plain',
            tempPreviewKey: undefined,
            width: undefined,
            height: undefined,
            format: 'plain'
        },
        {
            data: 'HTML',
            fileName: 'page.html',
            mediaType: 'html',
            mimeType: 'text/html',
            tempPreviewKey: undefined,
            width: undefined,
            height: undefined
        }
    ]);
});

test('buildFromTemp 保留 tempPreviewKey 和预览元数据，供服务端回传最终 temp 播放列表顺序', () => {
    const pm = new PlaylistManager(fakeManager);
    const list = pm.buildFromTemp([{
        name: 'voice.mp3',
        data: 'AUDIO',
        mediaType: 'audio',
        mimeType: 'audio/mpeg',
        tempPreviewKey: 'temp-key-1',
        width: 320,
        height: 180
    }], {
        mode: 'sequence',
        sortBy: 'name',
        direction: 'asc',
        mediaTypes: ['audio']
    });

    assert.deepStrictEqual(list[0], {
        data: 'AUDIO',
        fileName: 'voice.mp3',
        mediaType: 'audio',
        mimeType: 'audio/mpeg',
        tempPreviewKey: 'temp-key-1',
        width: 320,
        height: 180
    });
});
