'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { URL } = require('node:url');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const uploadPath = path.join(root, 'src/apps/web-mediacenter/ui/public/upload.html');
const scriptPath = path.join(root, 'src/apps/web-mediacenter/ui/public/js/server-list.js');

function createServerListContext(fetchImpl) {
    const elements = {
        serverListContent: { innerHTML: '' },
        serverListStatus: { textContent: '' },
        serverListRefreshBtn: { disabled: false, addEventListener() {} },
        serverAddressInput: { value: '' },
        serverAddressConnectBtn: { disabled: false, addEventListener() {} },
        serverMediaIndexContent: { innerHTML: '' },
        serverMediaIndexStatus: { textContent: '' },
        serverMediaIndexRefreshBtn: { disabled: false, addEventListener() {} }
    };
    const storage = new Map();
    const window = {
        showToast() {},
        location: { origin: 'https://main.test:8081', assign(url) { this.assigned = url; } },
        localStorage: { setItem(key, value) { storage.set(key, value); }, getItem(key) { return storage.get(key) || null; } }
    };
    const document = {
        addEventListener() {},
        getElementById(id) {
            return elements[id] || null;
        }
    };
    const context = { window, document, fetch: fetchImpl, console, URL };
    vm.runInNewContext(fs.readFileSync(scriptPath, 'utf8'), context, { filename: scriptPath });
    return { api: window.ServerList, elements, window };
}

test('控制端包含服务器导航入口、只读列表面板和服务器列表脚本', () => {
    const html = fs.readFileSync(uploadPath, 'utf8');

    assert.match(html, /data-target="servers"/);
    assert.match(html, /id="panel-servers"/);
    assert.match(html, /js\/server-list\.js/);
    assert.match(html, /id="serverAddressInput"/);
    assert.match(html, /id="serverAddressConnectBtn"/);
    assert.match(html, /id="serverMediaIndexContent"/);
});

test('服务器列表加载 AASC 节点目录接口并渲染节点信息', async () => {
    let requestUrl = '';
    const { api, elements } = createServerListContext(async (url) => {
        requestUrl = url;
        return {
            ok: true,
            async json() {
                return {
                    status: 'success',
                    servers: [{
                        nodeId: 'server-a',
                        name: '客厅服务器',
                        url: 'https://192.168.1.20:8081',
                        healthy: true,
                        latency: 12,
                        currentDisplays: 2,
                        runtime: { displayCount: 2, controlCount: 1, libraryCount: 3 },
                        lastHeartbeatAt: '2026-09-05T13:20:00.000Z'
                    }]
                };
            }
        };
    });

    await api.load();

    assert.equal(requestUrl, '/api/aasc/servers');
    assert.match(elements.serverListContent.innerHTML, /客厅服务器/);
    assert.match(elements.serverListContent.innerHTML, /server-a/);
    assert.match(elements.serverListContent.innerHTML, /在线/);
    assert.match(elements.serverListContent.innerHTML, /12 ms/);
    assert.match(elements.serverListContent.innerHTML, /显示端<\/dt><dd>2 \/ 未限制/);
    assert.match(elements.serverListContent.innerHTML, /控制端<\/dt><dd>1/);
    assert.match(elements.serverListContent.innerHTML, /媒体库<\/dt><dd>3/);
    assert.match(elements.serverListContent.innerHTML, /最后心跳/);
    assert.match(elements.serverListContent.innerHTML, /连接/);
});

test('服务器列表支持连接在线节点和手动输入服务器地址', async () => {
    const { api, window } = createServerListContext(async () => ({
        ok: true,
        async json() {
            return { status: 'success', servers: [] };
        }
    }));

    await api.connectToAddress('https://node.test:8081/');
    assert.equal(window.location.assigned, 'https://node.test:8081/control');

    await assert.rejects(
        () => api.connectToAddress('javascript:alert(1)'),
        /只支持 HTTP\/HTTPS/
    );
});

test('服务器列表请求失败时保留已有内容并显示错误状态', async () => {
    const { api, elements } = createServerListContext(async () => {
        throw new Error('连接失败');
    });
    elements.serverListContent.innerHTML = '<div>已有服务器</div>';

    await api.load();

    assert.match(elements.serverListContent.innerHTML, /已有服务器/);
    assert.match(elements.serverListStatus.textContent, /连接失败/);
});

test('服务器页面展示聚合后的共享媒体库摘要', async () => {
    const { api, elements } = createServerListContext(async (url) => {
        if (url === '/api/aasc/media-index') {
            return {
                ok: true,
                async json() {
                    return {
                        status: 'success',
                        index: {
                            sources: [{
                                node: { nodeId: 'node-a', name: '客厅服务器', url: 'https://node.test:8081' },
                                libraries: [{ id: 'photos', name: '照片', items: [{ name: 'a.jpg' }] }]
                            }],
                            errors: []
                        }
                    };
                }
            };
        }
        throw new Error('unexpected request');
    });

    await api.loadMediaIndex();

    assert.match(elements.serverMediaIndexContent.innerHTML, /客厅服务器/);
    assert.match(elements.serverMediaIndexContent.innerHTML, /照片/);
    assert.match(elements.serverMediaIndexContent.innerHTML, /1 个条目/);
});
