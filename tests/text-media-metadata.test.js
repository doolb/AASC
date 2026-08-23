'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { MediaLibraryProvider } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service.js');
const { PlaylistManager } = require('../src/apps/web-mediacenter/modules/media/playlist-app-service.js');

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
        url: '/media/1/guide.md', fileName: 'guide.md', mediaType: 'text', format: 'markdown'
    });
});
