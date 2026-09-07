'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const scriptPath = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/media-library.js');

function createMediaLibraryContext() {
    const elements = {
        mediaLibraryList: { innerHTML: '' },
        mediaLibraryBreadcrumb: { innerHTML: '' },
        mediaLibraryContent: { innerHTML: '' }
    };
    const window = {};
    const document = {
        getElementById(id) {
            return elements[id] || null;
        }
    };
    const context = {
        window,
        document,
        console,
        fetch: async () => ({ ok: true, async json() { return {}; } }),
        showToast() {},
        confirm() { return true; }
    };
    vm.runInNewContext(fs.readFileSync(scriptPath, 'utf8'), context, { filename: scriptPath });
    return { api: window.MediaLibrary, elements };
}

test('没有媒体库时仍显示添加媒体库按钮', () => {
    const { api, elements } = createMediaLibraryContext();
    api.libraries = [];

    api.renderLibraryList();

    assert.match(elements.mediaLibraryList.innerHTML, /暂无媒体库/);
    assert.match(elements.mediaLibraryList.innerHTML, /library-add-btn/);
    assert.match(elements.mediaLibraryList.innerHTML, /添加/);
});

test('媒体库目录项没有媒体 URL 时仍可进入子目录', () => {
    const { api, elements } = createMediaLibraryContext();

    api.renderFileList([{ name: 'storage', path: '/storage', type: 'folder' }]);

    assert.match(elements.mediaLibraryContent.innerHTML, /navigateToFolder\('\/storage'\)/);
    assert.doesNotMatch(elements.mediaLibraryContent.innerHTML, /媒体地址不可用/);
});

test('媒体库面板展平主服务器和子服务器媒体库并保留目标库读写状态', () => {
    const { api } = createMediaLibraryContext();
    const libraries = api.flattenNetworkLibraries({
        sources: [
            {
                node: { nodeId: 'main-server', name: '主服务器', url: 'https://main.test' },
                libraries: [{ id: 'main', name: '本地库', isDefault: true }]
            },
            {
                node: { nodeId: 'sub-node', name: 'Termux', url: 'https://sub.test' },
                libraries: [{ id: 'termux', name: 'Termux媒体库', items: [{ name: 'storage', type: 'folder' }] }]
            }
        ]
    });

    assert.equal(libraries.length, 2);
    assert.equal(libraries[0].id, 'main');
    assert.equal(libraries[0].isLocal, true);
    assert.equal(libraries[1].id, 'sub-node::termux');
    assert.equal(libraries[1].name, 'Termux / Termux媒体库');
    assert.equal(libraries[1].sourceLibraryId, 'termux');
    assert.equal(libraries[1].remote, true);
    assert.equal(libraries[1].readonly, false);
});

test('远程媒体库保留直连地址和主服务器代理地址', () => {
    const { api } = createMediaLibraryContext();
    const libraries = api.flattenNetworkLibraries({
        sources: [{
            node: { nodeId: 'termux-subserver', name: 'Termux', url: 'https://192.168.1.6:8081' },
            libraries: [{
                id: 'termux-media',
                name: 'Termux媒体库',
                proxyUrl: 'https://192.168.1.39:8081/api/aasc/servers/termux-subserver/media-libraries/termux-media/proxy/',
                items: [{
                    name: '演示图.png',
                    path: '/演示图.png',
                    url: 'https://192.168.1.6:8081/media/termux-media/%E6%BC%94%E7%A4%BA%E5%9B%BE.png'
                }]
            }]
        }]
    });

    assert.equal(libraries[0].items[0].directUrl, 'https://192.168.1.6:8081/media/termux-media/%E6%BC%94%E7%A4%BA%E5%9B%BE.png');
    assert.equal(libraries[0].items[0].proxyUrl, 'https://192.168.1.39:8081/api/aasc/servers/termux-subserver/media-libraries/termux-media/proxy/%E6%BC%94%E7%A4%BA%E5%9B%BE.png');
    assert.equal(api.getPlaybackUrl(libraries[0].items[0]), libraries[0].items[0].directUrl);
    assert.equal(api.getPlaybackFallbackUrl(libraries[0].items[0]), libraries[0].items[0].proxyUrl);
});

test('远程媒体库操作使用真实库 ID而不是展示用复合 ID', () => {
    const { api } = createMediaLibraryContext();
    const library = {
        id: 'termux-subserver::termux-media',
        sourceLibraryId: 'termux-media',
        ownerNodeId: 'termux-subserver',
        remote: true
    };

    const request = api.getLibraryRequest(library, 'update');
    assert.equal(request.url, '/api/aasc/servers/termux-subserver/media-libraries/termux-media');
    assert.equal(request.method, 'PUT');
});

test('远程媒体没有直连地址时播放主服务器代理地址而不是空地址', () => {
    const { api } = createMediaLibraryContext();
    const item = {
        directUrl: null,
        url: null,
        proxyUrl: '/api/aasc/servers/node-a/media-libraries/media-a/proxy/a.jpg'
    };

    assert.equal(api.getPlaybackUrl(item), item.proxyUrl);
    assert.equal(api.getPlaybackFallbackUrl(item), '');
});
