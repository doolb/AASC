'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AascMediaIndexService } = require('../src/framework/aasc/media-index-service');

function createManager() {
    return {
        listLibraries() {
            return [{ id: 'local-images', name: '本地图片', type: 'local', readonly: false }];
        },
        async list(libraryId, path) {
            assert.equal(libraryId, 'local-images');
            assert.equal(path, '/');
            return [{ name: 'a.jpg', path: 'a.jpg', type: 'image', mediaType: 'image', format: 'jpg', url: 'https://main.test/media/a.jpg', size: 12 }];
        }
    };
}

test('本地媒体索引包含节点地址、媒体库和目录条目', async () => {
    const service = new AascMediaIndexService({
        mediaLibraryManager: createManager(),
        getNode: () => ({ nodeId: 'main-server', url: 'https://192.168.1.39:8081' })
    });

    const index = await service.buildLocalIndex('/');

    assert.equal(index.node.nodeId, 'main-server');
    assert.equal(index.libraries[0].id, 'local-images');
    assert.equal(index.libraries[0].items[0].name, 'a.jpg');
    assert.equal(index.libraries[0].items[0].ownerUrl, 'https://192.168.1.39:8081');
    assert.equal(index.libraries[0].items[0].mediaType, 'image');
    assert.equal(index.libraries[0].items[0].format, 'jpg');
    assert.equal(index.libraries[0].items[0].url, 'https://main.test/media/a.jpg');
    assert.match(index.libraries[0].listUrl, /\/api\/media-libraries\/local-images\/list/);
});

test('网络媒体索引聚合在线节点并隔离不可达节点', async () => {
    const requests = [];
    const service = new AascMediaIndexService({
        mediaLibraryManager: createManager(),
        getNode: () => ({ nodeId: 'main-server', url: 'https://main.test' }),
        getRemoteNodes: () => [
            { nodeId: 'node-a', url: 'https://a.test', status: 'online' },
            { nodeId: 'node-b', url: 'https://b.test', status: 'online' }
        ],
        fetchJson: async (url) => {
            requests.push(url);
            if (url.startsWith('https://b.test')) throw new Error('连接失败');
            return {
                status: 'success',
                index: {
                    node: { nodeId: 'node-a', url: 'https://a.test' },
                    path: '/',
                    libraries: [{ id: 'remote', name: '远程库', items: [] }]
                }
            };
        }
    });

    const result = await service.buildNetworkIndex('/');

    assert.equal(result.sources.length, 2);
    assert.equal(result.sources[1].node.nodeId, 'node-a');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].nodeId, 'node-b');
    assert.equal(requests.length, 2);
});

test('网络媒体索引优先通过节点会话请求而不是访问节点 HTTP 地址', async () => {
    const requests = [];
    const service = new AascMediaIndexService({
        mediaLibraryManager: createManager(),
        getNode: () => ({ nodeId: 'main-server', url: 'https://main.test' }),
        getRemoteNodes: () => [
            { nodeId: 'node-a', url: 'https://a.test', status: 'online' }
        ],
        requestRemoteIndex: async (node, path) => {
            requests.push({ node, path });
            return {
                node: { nodeId: node.nodeId, url: node.url },
                path,
                libraries: []
            };
        },
        fetchJson: async () => {
            throw new Error('不应访问远程 HTTP 索引');
        }
    });

    const result = await service.buildNetworkIndex('/music');

    assert.equal(result.sources.length, 2);
    assert.deepEqual(requests.map(item => ({ nodeId: item.node.nodeId, path: item.path })), [
        { nodeId: 'node-a', path: '/music' }
    ]);
});

test('远程媒体索引同时保留直连地址和主服务器代理地址', async () => {
    const service = new AascMediaIndexService({
        mediaLibraryManager: createManager(),
        getNode: () => ({ nodeId: 'main-server', url: 'https://main.test' }),
        getRemoteNodes: () => [
            { nodeId: 'node-a', url: 'https://a.test', status: 'online' }
        ],
        requestRemoteIndex: async () => ({
            node: { nodeId: 'node-a', url: 'https://a.test' },
            path: '/',
            libraries: [{
                id: 'remote',
                items: [{
                    name: '演示图.png',
                    path: '/演示图.png',
                    url: 'https://a.test/media/remote/%E6%BC%94%E7%A4%BA%E5%9B%BE.png'
                }]
            }]
        }),
        getRemoteMediaProxyUrl: (node, libraryId, itemPath) => (
            `/api/aasc/servers/${node.nodeId}/media-libraries/${libraryId}/proxy${encodeURIComponent(itemPath).replace(/%2F/g, '/')}`
        )
    });

    const result = await service.buildNetworkIndex('/');
    const item = result.sources[1].libraries[0].items[0];

    assert.equal(item.url, 'https://a.test/media/remote/%E6%BC%94%E7%A4%BA%E5%9B%BE.png');
    assert.equal(item.directUrl, item.url);
    assert.equal(item.proxyUrl, '/api/aasc/servers/node-a/media-libraries/remote/proxy/%E6%BC%94%E7%A4%BA%E5%9B%BE.png');
});

test('远程媒体直连地址使用节点注册地址重写主机部分', async () => {
    const service = new AascMediaIndexService({
        mediaLibraryManager: createManager(),
        getNode: () => ({ nodeId: 'main-server', url: 'https://main.test' }),
        getRemoteNodes: () => [
            { nodeId: 'node-a', url: 'https://192.168.1.6:8081', status: 'online' }
        ],
        requestRemoteIndex: async () => ({
            node: { nodeId: 'node-a', url: 'http://127.0.0.1:8081' },
            path: '/',
            libraries: [{
                id: 'remote',
                type: 'local',
                items: [{
                    name: '演示图.png',
                    path: '/演示图.png',
                    url: 'http://127.0.0.1:8081/api/media-libraries/remote/proxy/%E6%BC%94%E7%A4%BA%E5%9B%BE.png'
                }]
            }]
        }),
        getRemoteMediaProxyUrl: (node, libraryId, itemPath) => (
            `/api/aasc/servers/${node.nodeId}/media-libraries/${libraryId}/proxy${encodeURIComponent(itemPath).replace(/%2F/g, '/')}`
        )
    });

    const result = await service.buildNetworkIndex('/');
    const item = result.sources[1].libraries[0].items[0];

    assert.equal(item.directUrl, 'https://192.168.1.6:8081/api/media-libraries/remote/proxy/%E6%BC%94%E7%A4%BA%E5%9B%BE.png');
    assert.equal(item.url, item.directUrl);
});

test('远程媒体没有条目 URL 时按节点地址和媒体库路径补全直连地址', async () => {
    const service = new AascMediaIndexService({
        mediaLibraryManager: createManager(),
        getNode: () => ({ nodeId: 'main-server', url: 'https://main.test' }),
        getRemoteNodes: () => [
            { nodeId: 'node-a', url: 'https://192.168.1.6:8081', status: 'online' }
        ],
        requestRemoteIndex: async () => ({
            node: { nodeId: 'node-a' },
            path: '/',
            libraries: [{
                id: 'remote',
                type: 'local',
                items: [{ name: '演示图.png', path: '/演示图.png', url: null }]
            }]
        })
    });

    const result = await service.buildNetworkIndex('/');
    const item = result.sources[1].libraries[0].items[0];

    assert.equal(item.directUrl, 'https://192.168.1.6:8081/api/media-libraries/remote/proxy/%E6%BC%94%E7%A4%BA%E5%9B%BE.png');
    assert.equal(item.url, item.directUrl);
});
