'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const uploadPath = path.join(root, 'src/apps/web-mediacenter/ui/public/upload.html');
const scriptPath = path.join(root, 'src/apps/web-mediacenter/ui/public/js/server-list.js');

function createServerListContext(fetchImpl) {
    const elements = {
        serverListContent: { innerHTML: '' },
        serverListStatus: { textContent: '' },
        serverListRefreshBtn: { disabled: false, addEventListener() {} }
    };
    const window = { showToast() {} };
    const document = {
        addEventListener() {},
        getElementById(id) {
            return elements[id] || null;
        }
    };
    const context = { window, document, fetch: fetchImpl, console };
    vm.runInNewContext(fs.readFileSync(scriptPath, 'utf8'), context, { filename: scriptPath });
    return { api: window.ServerList, elements };
}

test('控制端包含服务器导航入口、只读列表面板和服务器列表脚本', () => {
    const html = fs.readFileSync(uploadPath, 'utf8');

    assert.match(html, /data-target="servers"/);
    assert.match(html, /id="panel-servers"/);
    assert.match(html, /js\/server-list\.js/);
});

test('服务器列表加载现有子服务器接口并渲染节点信息', async () => {
    let requestUrl = '';
    const { api, elements } = createServerListContext(async (url) => {
        requestUrl = url;
        return {
            ok: true,
            async json() {
                return {
                    status: 'success',
                    servers: [{
                        id: 'server-a',
                        name: '客厅服务器',
                        url: 'https://192.168.1.20:8081',
                        healthy: true,
                        latency: 12,
                        currentDisplays: 2
                    }]
                };
            }
        };
    });

    await api.load();

    assert.equal(requestUrl, '/api/subservers');
    assert.match(elements.serverListContent.innerHTML, /客厅服务器/);
    assert.match(elements.serverListContent.innerHTML, /server-a/);
    assert.match(elements.serverListContent.innerHTML, /在线/);
    assert.match(elements.serverListContent.innerHTML, /12 ms/);
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
