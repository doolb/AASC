'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { MediaLibraryProvider, LocalProvider } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service.js');

const provider = new MediaLibraryProvider({});

test('detectMediaType 识别 html/htm/mhtml 文件', () => {
    assert.strictEqual(provider.detectMediaType('page.html'), 'html');
    assert.strictEqual(provider.detectMediaType('page.HTM'), 'html');
    assert.strictEqual(provider.detectMediaType('page.htm?t=123'), 'html');
    assert.strictEqual(provider.detectMediaType('page.mhtml'), 'html');
    assert.strictEqual(provider.detectMediaType('page.MHTML'), 'html');
});

test('detectMediaType 保持原有类型识别', () => {
    assert.strictEqual(provider.detectMediaType('a.gif'), 'gif');
    assert.strictEqual(provider.detectMediaType('a.mp4'), 'video');
    assert.strictEqual(provider.detectMediaType('a.jpg'), 'image');
});

test('getPublicUrl 保留路径分隔符（/ 不编码为 %2F）', () => {
    // uploads 目录分支（子目录文件：/ 必须保留，否则 express.static 404）
    const uploadsDir = path.resolve(process.cwd(), 'res', 'uploads');
    const p1 = new LocalProvider({ path: uploadsDir }, {
        getPort: () => 8081,
        getLocalIP: () => '127.0.0.1',
        isHttps: () => false
    });
    const url1 = p1.getPublicUrl('html/[2V+16P_53M]习呆呆.html');
    assert.strictEqual(
        url1,
        'http://127.0.0.1:8081/uploads/html/%5B2V%2B16P_53M%5D%E4%B9%A0%E5%91%86%E5%91%86.html'
    );
    assert.ok(!url1.includes('%2F'), '路径分隔符不应被编码为 %2F');

    // 媒体库目录分支（routePrefix /media/{id}）
    const p2 = new LocalProvider({ id: 'media-lib-test', path: '/tmp/media-lib-test' }, {
        getPort: () => 8081,
        getLocalIP: () => '127.0.0.1',
        isHttps: () => false
    });
    const url2 = p2.getPublicUrl('sub/a b.jpg');
    assert.ok(url2.startsWith('http://127.0.0.1:8081/media/media-lib-test/sub/a%20b.jpg'));
    assert.ok(!url2.includes('%2F'), '路径分隔符不应被编码为 %2F');
});
