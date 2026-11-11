'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

test('代理列表、B 站与所属任务实例中的来源选择使用服务端权威配置', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const html = fs.readFileSync(path.join(root, 'upload.html'), 'utf8');
    const $ = cheerio.load(html);
    assert.equal($('#bilibiliProxyToggle').length, 0);
    assert.equal($('#bilibiliProxySelect').length, 1);
    assert.equal($('#bilibiliProxySelect').closest('label').is('[hidden]'), false);
    assert.equal($('#quarkProxySelect').length, 1);
    assert.equal($('#webProxyList').length, 1);
    assert.equal($('#webProxyAddBtn').length, 1);
    assert.equal($('#webProxySaveBtn').length, 1);

    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`
        <div id="webProxyList"></div>
        <button id="webProxyAddBtn" type="button"></button>
        <button id="webProxySaveBtn" type="button"></button>
        <select id="bilibiliProxySelect" data-provider-proxy="bilibili"></select>
        <span id="domesticMediaTabs"></span>
        <span id="overseasMediaTabs"></span>
        <div id="taskResultCol"></div>
        <div id="mediaLibraryContent"></div>
    `);
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.addScriptTag({ path: path.join(root, 'js/task-panel.js') });
    await page.evaluate(() => {
        TaskPanel.init = () => {};
        TaskPanel._selectedInstanceId = 'instance-1';
        TaskPanel.taskList = [{ taskName: 'media', instances: [{ instanceId: 'instance-1', status: 'running', logs: [] }] }];
        TaskPanel._resultDetailHTML = () => '';
        document.getElementById('taskResultCol').innerHTML = TaskPanel._renderResultCol('media', 'instance-1');
        window.showToast = () => {};
        window.sent = [];
        window.WebSocketManager = { ws: { readyState: WebSocket.OPEN }, send: message => window.sent.push(message) };
        MediaLibrary.handleTaskMediaSources({
            providers: [
                { id: 'hongguo', name: '红果短剧', libraryId: 'task-auto:hongguo', region: 'domestic', ownerInstanceId: 'instance-1' },
                { id: 'youtube', name: 'YouTube', libraryId: 'task-auto:youtube', region: 'overseas', ownerInstanceId: 'instance-1' },
                { id: 'other', name: '其他', libraryId: 'task-auto:other', ownerInstanceId: 'instance-2' }
            ]
        });
        MediaLibrary.handleWebProxyConfig({
            webProxies: [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' }],
            providerProxy: { bilibili: 'p1', hongguo: 'p1', youtube: '' },
            sources: [
                { id: 'bilibili', name: 'B 站视频', region: 'domestic', proxyId: 'p1' },
                { id: 'hongguo', name: '红果短剧', region: 'domestic', proxyId: 'p1' },
                { id: 'youtube', name: 'YouTube', region: 'overseas', proxyId: '' }
            ]
        });
    });

    // 保留真实初始化绑定，隔离与代理无关的网络加载和媒体库渲染。
    await page.evaluate(async () => {
        for (const method of ['loadLibraries', 'refreshTaskMediaSources', 'setupDragDrop', 'render', 'refreshQuarkDirectoryDownload']) {
            MediaLibrary[method] = () => {};
        }
        await MediaLibrary.init();
    });
    assert.equal(await page.$$eval('#webProxyList [data-proxy-row]', nodes => nodes.length), 1);
    assert.equal(await page.$eval('#webProxyList [data-proxy-name]', node => node.value), '公司代理');
    assert.equal(await page.$eval('#webProxyList [data-proxy-url]', node => node.value), 'http://127.0.0.1:7890');
    assert.equal(await page.$eval('#bilibiliProxySelect', node => node.value), 'p1');
    assert.equal(await page.$$eval('#bilibiliProxySelect option', nodes => nodes.map(node => node.textContent).join(',')), '不使用代理,公司代理');
    assert.equal(await page.$eval('[data-task-media-proxy="hongguo"]', node => node.tagName), 'SELECT');
    assert.equal(await page.$eval('[data-task-media-proxy="hongguo"]', node => node.value), 'p1');
    assert.equal(await page.$eval('[data-task-media-proxy="youtube"]', node => node.value), '');
    assert.equal(await page.$('[data-task-media-proxy="other"]'), null);
    assert.equal(await page.$('.media-library-tabs select'), null);
    await page.evaluate(() => { TaskPanel._selectedInstanceId = 'instance-2'; TaskPanel.refreshTaskMediaProxySettings(); });
    assert.equal(await page.$('[data-task-media-proxy="hongguo"]'), null);
    assert.ok(await page.$('[data-task-media-proxy="other"]'));
    await page.evaluate(() => { TaskPanel._selectedInstanceId = 'instance-1'; TaskPanel.refreshTaskMediaProxySettings(); });

    await page.select('#bilibiliProxySelect', '');
    assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), {
        type: 'setProviderProxy', sourceId: 'bilibili', proxyId: ''
    });
    assert.equal(await page.evaluate(() => MediaLibrary.webProxyConfig.providerProxy.bilibili), 'p1');

    await page.select('[data-task-media-proxy="hongguo"]', '');
    assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), {
        type: 'setProviderProxy', sourceId: 'hongguo', proxyId: ''
    });

    // 通过真实 WebSocket 分发表验证保存失败后恢复 B 站和任务源的权威选择。
    await page.addScriptTag({ path: path.join(root, 'js/websocket.js') });
    await page.evaluate(() => {
        WebSocketManager.ws = { readyState: WebSocket.OPEN, send: value => window.sent.push(JSON.parse(value)) };
        CONTROL_REMOTE_CONFIG_HANDLERS.webProxyConfigError({ message: '服务端拒绝保存' });
    });
    assert.equal(await page.$eval('#bilibiliProxySelect', node => node.value), 'p1');
    assert.equal(await page.$eval('[data-task-media-proxy="hongguo"]', node => node.value), 'p1');
    assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), { type: 'getWebProxyConfig' });

    // 断线时真实 send 会静默跳过：选择必须当场恢复且不发送请求。
    const sentCount = await page.evaluate(() => {
        WebSocketManager.ws.readyState = WebSocket.CLOSED;
        return window.sent.length;
    });
    await page.select('#bilibiliProxySelect', '');
    await page.select('[data-task-media-proxy="hongguo"]', '');
    assert.equal(await page.$eval('#bilibiliProxySelect', node => node.value), 'p1');
    assert.equal(await page.$eval('[data-task-media-proxy="hongguo"]', node => node.value), 'p1');
    assert.equal(await page.evaluate(() => window.sent.length), sentCount);
    await page.evaluate(() => { WebSocketManager.ws.readyState = WebSocket.OPEN; });

    await page.click('#webProxyAddBtn');
    await page.evaluate(() => {
        const rows = document.querySelectorAll('#webProxyList [data-proxy-row]');
        const row = rows[rows.length - 1];
        row.querySelector('[data-proxy-name]').value = '备用代理';
        row.querySelector('[data-proxy-url]').value = 'socks5://127.0.0.1:1080';
        document.getElementById('webProxySaveBtn').click();
    });
    const saved = await page.evaluate(() => window.sent.at(-1));
    assert.equal(saved.type, 'setWebProxyList');
    assert.equal(saved.webProxies.length, 2);
    assert.equal(saved.webProxies[0].id, 'p1');
    assert.equal(saved.webProxies[1].name, '备用代理');
    assert.equal(Object.hasOwn(saved.webProxies[1], 'id'), false);
    await page.click('#webProxyList [data-proxy-remove]');
    await page.click('#webProxySaveBtn');
    assert.equal(await page.evaluate(() => window.sent.at(-1).webProxies.length), 1);
    // 编辑列表不会抢先更改来源代理；等待服务端权威广播。
    assert.equal(await page.evaluate(() => MediaLibrary.webProxyConfig.webProxies.length), 1);
    await page.evaluate(() => {
        window.toasts = [];
        window.showToast = (...args) => window.toasts.push(args);
        for (let index = 0; index < 25; index++) MediaLibrary.addWebProxyRow();
    });
    assert.equal(await page.$$eval('#webProxyList [data-proxy-row]', nodes => nodes.length), 20);
    assert.equal(await page.evaluate(() => window.toasts.at(-1)[0]), '代理数量超出限制（最多 20 个）');


    await page.evaluate(() => MediaLibrary.handleWebProxyConfig({
        webProxies: [], providerProxy: { bilibili: '' }, sources: [{ id: 'bilibili', proxyId: '' }]
    }));
    assert.equal(await page.$eval('#bilibiliProxySelect', node => node.value), '');
    assert.equal(await page.$$eval('#webProxyList [data-proxy-row]', nodes => nodes.length), 0);
    assert.equal(await page.$eval('[data-task-media-proxy="hongguo"]', node => node.value), '');
});
