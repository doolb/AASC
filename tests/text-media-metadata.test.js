'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MediaLibraryProvider, LocalProvider } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service.js');
const { PlaylistManager } = require('../src/apps/web-mediacenter/modules/media/playlist-app-service.js');
let createUploadedMediaData;
try {
    ({ createUploadedMediaData } = require('../src/apps/server/modules/media/upload-media-metadata.js'));
} catch (error) {
    createUploadedMediaData = null;
}

const provider = new MediaLibraryProvider({});
const fakeManager = {
    async list() {
        return [{
            name: 'guide.md',
            path: '/guide.md',
            type: 'file',
            mediaType: 'text',
            format: 'markdown',
            url: '/media/1/guide.md'
        }];
    }
};

test('detects txt and md as text with the correct format', () => {
    assert.equal(provider.detectMediaType('note.txt'), 'text');
    assert.equal(provider.detectTextFormat('note.txt'), 'plain');
    assert.equal(provider.detectMediaType('guide.MD'), 'text');
    assert.equal(provider.detectTextFormat('guide.MD'), 'markdown');
});

test('library playlist keeps text format metadata', async () => {
    const playlist = await new PlaylistManager(fakeManager).buildFromLibrary('local', '/');
    assert.deepEqual(playlist[0], {
        url: '/media/1/guide.md', path: '/guide.md', fileName: 'guide.md', mediaType: 'text', format: 'markdown'
    });
});

test('LocalProvider 从 txt 和 md 文件名生成 text format 元数据', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-text-media-'));
    const localProvider = new LocalProvider({ id: 'text-library', path: directory });
    fs.writeFileSync(path.join(directory, 'note.txt'), 'plain text');
    fs.writeFileSync(path.join(directory, 'guide.md'), '# markdown');

    try {
        const items = await localProvider.list('/');
        assert.deepEqual(items.map(item => [item.name, item.mediaType, item.format]), [
            ['guide.md', 'text', 'markdown'],
            ['note.txt', 'text', 'plain']
        ]);
        const file = await localProvider.getFile('/guide.md');
        assert.equal(file.format, 'markdown');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('temporary text playlist keeps format and MIME metadata', () => {
    const playlist = new PlaylistManager(fakeManager).buildFromTemp([{
        name: 'guide.md',
        data: 'IyBtYXJrZG93bg==',
        mediaType: 'text',
        format: 'markdown',
        mimeType: 'text/markdown'
    }]);

    assert.deepEqual(playlist[0], {
        data: 'IyBtYXJrZG93bg==',
        fileName: 'guide.md',
        mediaType: 'text',
        mimeType: 'text/markdown',
        tempPreviewKey: undefined,
        width: undefined,
        height: undefined,
        format: 'markdown'
    });
});

test('普通上传构造 text format/MIME 且不污染非文本 mediaData', () => {
    assert.equal(typeof createUploadedMediaData, 'function');
    const base = { url: 'http://localhost/uploads/file', timestamp: 123 };

    assert.deepEqual(createUploadedMediaData({ ...base, fileName: 'guide.md' }), {
        type: 'url',
        url: base.url,
        fileName: 'guide.md',
        mediaType: 'text',
        format: 'markdown',
        mimeType: 'text/markdown',
        timestamp: base.timestamp
    });
    assert.deepEqual(createUploadedMediaData({ ...base, fileName: 'note.txt' }), {
        type: 'url',
        url: base.url,
        fileName: 'note.txt',
        mediaType: 'text',
        format: 'plain',
        mimeType: 'text/plain',
        timestamp: base.timestamp
    });
    assert.deepEqual(createUploadedMediaData({ ...base, fileName: 'photo.jpg' }), {
        type: 'url',
        url: base.url,
        fileName: 'photo.jpg',
        mediaType: 'image',
        timestamp: base.timestamp
    });
});

test('playlistStart 切换 URL 和临时 text 项时将 format 传给 showMedia', () => {
    const display = fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html'), 'utf8');
    const playCurrentStart = display.indexOf('        function playCurrentItem(options = {})');
    const showMediaCall = display.indexOf('            showMedia(mediaData, true, ps.paused, resumeTime);', playCurrentStart);
    const playCurrentItem = display.slice(playCurrentStart, showMediaCall);

    assert.match(playCurrentItem, /url: item\.url, fallbackUrl: item\.fallbackUrl, fileName: item\.fileName, mediaType: item\.mediaType, \.\.\.\(item\.mediaType === 'text' \? \{ format: item\.format, route: getPlaylistTextRoute\(ps\) \} : \{\}\)/);
    assert.match(playCurrentItem, /data: item\.data, fileName: item\.fileName, mediaType: item\.mediaType, mimeType: item\.mimeType, \.\.\.\(item\.mediaType === 'text' \? \{ format: item\.format, route: getPlaylistTextRoute\(ps\) \} : \{\}\)/);
});
