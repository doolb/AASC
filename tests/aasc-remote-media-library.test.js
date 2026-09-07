'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    createRemoteMediaLibraryHandlers,
    requestRemoteMediaLibrary,
    buildRemoteMediaProxyPath
} = require('../src/framework/aasc/remote-media-library');

test('子服务器添加媒体库命令会持久化配置并注册本地路由', async () => {
    const calls = [];
    const manager = {
        async addLibraryFromConfig(config) {
            calls.push({ type: 'add', config });
            return { id: 'termux-media', name: config.name, type: config.type, path: config.path };
        },
        async removeLibrary(id) {
            calls.push({ type: 'remove', id });
        },
        saveConfig() {
            calls.push({ type: 'save' });
        }
    };
    const handlers = createRemoteMediaLibraryHandlers({
        mediaLibraryManager: manager,
        registerLocalRoutes: async library => calls.push({ type: 'route', library })
    });

    const result = await handlers.get('media.library.add')({
        name: 'Termux存储',
        type: 'local',
        path: '/storage',
        password: 'secret'
    });

    assert.equal(result.library.id, 'termux-media');
    assert.equal(result.library.password, undefined);
    assert.deepEqual(calls.map(call => call.type), ['add', 'route']);
    assert.equal(calls[0].config.password, 'secret');
});

test('主服务器远程媒体库操作通过已连接节点请求', async () => {
    const calls = [];
    const registry = {
        get(nodeId) {
            return { nodeId, status: 'online', connected: true };
        },
        async request(nodeId, command, payload, timeoutMs) {
            calls.push({ nodeId, command, payload, timeoutMs });
            return { library: { id: payload.id || 'remote' } };
        }
    };

    const result = await requestRemoteMediaLibrary({
        registry,
        nodeId: 'termux-subserver',
        command: 'media.library.update',
        payload: { id: 'termux-media', name: '更新后的媒体库' },
        timeoutMs: 3000
    });

    assert.equal(result.library.id, 'termux-media');
    assert.deepEqual(calls, [{
        nodeId: 'termux-subserver',
        command: 'media.library.update',
        payload: { id: 'termux-media', name: '更新后的媒体库' },
        timeoutMs: 3000
    }]);
});

test('主服务器媒体代理路径使用原始节点和媒体库 ID', () => {
    assert.equal(
        buildRemoteMediaProxyPath('termux-subserver', 'termux-media', '/storage/演示图.png'),
        '/api/aasc/servers/termux-subserver/media-libraries/termux-media/proxy/storage/%E6%BC%94%E7%A4%BA%E5%9B%BE.png'
    );
});
