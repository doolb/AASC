'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { MediaLibraryProvider } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service.js');

const provider = new MediaLibraryProvider({});

test('detectMediaType 识别 html/htm 文件', () => {
    assert.strictEqual(provider.detectMediaType('page.html'), 'html');
    assert.strictEqual(provider.detectMediaType('page.HTM'), 'html');
    assert.strictEqual(provider.detectMediaType('page.htm?t=123'), 'html');
});

test('detectMediaType 保持原有类型识别', () => {
    assert.strictEqual(provider.detectMediaType('a.gif'), 'gif');
    assert.strictEqual(provider.detectMediaType('a.mp4'), 'video');
    assert.strictEqual(provider.detectMediaType('a.jpg'), 'image');
});
