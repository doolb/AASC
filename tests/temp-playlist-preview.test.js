'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const TempPlaylistPreview = require('../src/apps/web-mediacenter/ui/public/js/temp-playlist-preview.js');

test('buildServerOrderedFiles 按服务端最终 playlist 顺序重建本地临时预览队列', () => {
    const cachedFiles = [
        { fileName: 'b.mp3', mediaType: 'audio', data: 'BBB', mimeType: 'audio/mpeg', tempPreviewKey: 'key-b' },
        { fileName: 'a.jpg', mediaType: 'image', data: 'AAA', mimeType: 'image/jpeg', tempPreviewKey: 'key-a' },
        { fileName: 'c.txt', mediaType: 'text', data: 'CCC', mimeType: 'text/plain', format: 'plain', tempPreviewKey: 'key-c' }
    ];
    const playlist = [
        { fileName: 'a.jpg', mediaType: 'image', mimeType: 'image/jpeg', tempPreviewKey: 'key-a' },
        { fileName: 'c.txt', mediaType: 'text', mimeType: 'text/plain', format: 'plain', tempPreviewKey: 'key-c' }
    ];

    const alignedFiles = TempPlaylistPreview.buildServerOrderedFiles(playlist, cachedFiles);

    assert.deepStrictEqual(alignedFiles.map((item) => [item.fileName, item.tempPreviewKey, item.data]), [
        ['a.jpg', 'key-a', 'AAA'],
        ['c.txt', 'key-c', 'CCC']
    ]);
});

test('findCachedFile 优先按 tempPreviewKey 对齐，避免沿用原始 index 错位', () => {
    const cachedFiles = [
        { fileName: 'b.mp3', mediaType: 'audio', data: 'BBB', tempPreviewKey: 'key-b' },
        { fileName: 'a.jpg', mediaType: 'image', data: 'AAA', tempPreviewKey: 'key-a' }
    ];

    const matchedFile = TempPlaylistPreview.findCachedFile(cachedFiles, {
        index: 0,
        tempPreviewKey: 'key-a'
    });

    assert.deepStrictEqual(matchedFile, {
        fileName: 'a.jpg',
        mediaType: 'image',
        data: 'AAA',
        tempPreviewKey: 'key-a'
    });
});
