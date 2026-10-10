'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const controlSource = fs.readFileSync(path.join(publicDir, 'js/websocket.js'), 'utf8');
const displaySource = fs.readFileSync(path.join(publicDir, 'display.html'), 'utf8');
const displayRestartState = displaySource.slice(
    displaySource.indexOf('        let observedServerStartTime = null;'),
    displaySource.indexOf('        function clearDisplayReconnectTimer()')
);
// 直接运行正式连接函数和消息处理入口，避免复制一套用于测试的重启算法。
function declaration(name) {
    const match = displaySource.match(new RegExp(`function ${name}\\([^]*?\\n        \\}`));
    assert.ok(match, `正式显示页存在 ${name}`);
    return match[0];
}
const displayRuntime = `
    ${displayRestartState}
    let displayWs = null, displayId = null;
    const displayPageActive = true;
    const clearDisplayReconnectTimer = () => {};
    const getPersistentDisplayId = () => 'offline-test';
    const bindDisplayStageTransport = () => {};
    const setCorrelationId = () => {};
    class WebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        constructor() { this.readyState = 1; }
    }
    ${declaration('isCurrentDisplaySocket')}
    ${declaration('connectWebSocket')}
    connectWebSocket();
    window.receive = data => displayWs.onmessage({ data: JSON.stringify(data) });
`;

function sharedStorage() {
    const values = new Map([['serverStartTime', '50'], ['chatTarget', '小爱']]);
    return {
        values,
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value))
    };
}

function createPage(role, storage = sharedStorage()) {
    let reloads = 0;
    const context = vm.createContext({
        window: { location: { protocol: 'http:', host: 'offline.test' } },
        location: { reload() { reloads += 1; } },
        localStorage: storage,
        console: { log() {}, warn() {}, error() {} }
    });
    vm.runInContext(role === 'control' ? controlSource : displayRuntime, context);
    const receive = role === 'control'
        ? data => context.window.WebSocketManager.handleMessage(data)
        : context.window.receive;
    return { context, receive, restart: time => receive({ type: 'serverStartTime', time }),
        get reloads() { return reloads; } };
}

for (const order of [['display', 'control'], ['control', 'display']]) {
    test(`同源双页重启顺序 ${order.join('→')} 均刷新一次`, () => {
        const storage = sharedStorage();
        const pages = { control: createPage('control', storage), display: createPage('display', storage) };
        pages.control.restart(100);
        pages.display.restart(100);
        assert.equal(pages.control.reloads + pages.display.reloads, 0, '首连不刷新');
        for (const role of order) {
            pages[role].restart(200);
            // 模拟旧页继续写共享记录，不能掩盖另一页自己的重启基准。
            storage.setItem('serverStartTime', 200);
        }
        assert.equal(pages.control.reloads, 1);
        assert.equal(pages.display.reloads, 1);
        for (const page of Object.values(pages)) {
            page.restart(200);
            page.restart(300);
            assert.equal(page.reloads, 1, '正在刷新时重复或更新的消息不再次刷新');
        }
        assert.equal(storage.getItem('chatTarget'), '小爱');
    });
}

for (const role of ['control', 'display']) {
    test(`${role} 同版本重连、冷加载和刷新恢复不循环`, () => {
        const storage = sharedStorage();
        const page = createPage(role, storage);
        for (const time of [100, '100', 100]) page.restart(time);
        assert.equal(page.reloads, 0);
        page.restart(200);
        assert.equal(page.reloads, 1);
        const reloaded = createPage(role, storage);
        reloaded.restart(200);
        reloaded.restart('200');
        assert.equal(reloaded.reloads, 0);
        reloaded.restart(300);
        assert.equal(reloaded.reloads, 1, '新的页面仍能检测下一次重启');
        assert.equal(storage.getItem('serverStartTime'), '50', '旧标记保留但不再使用');
    });

    test(`${role} 存储拒绝访问时仍刷新且普通消息继续处理`, () => {
        const storage = new Proxy({}, { get() { throw new Error('SecurityError'); } });
        const page = createPage(role, storage);
        page.restart(100);
        page.restart(200);
        page.restart(200);
        assert.equal(page.reloads, 1);
        if (role === 'display') {
            page.receive({ type: 'displayId', id: 'restored-device' });
            assert.equal(vm.runInContext('displayId', page.context), 'restored-device');
        }
    });

    test(`${role} 无效时间不建立基准也不触发重载`, () => {
        const page = createPage(role);
        for (const time of [null, undefined, true, {}, [], '', 'oops', 0, -1, NaN, Infinity]) {
            page.restart(time);
        }
        page.restart(100);
        assert.equal(page.reloads, 0);
        page.restart('100');
        page.restart(200);
        assert.equal(page.reloads, 1);
    });
}

test('同源多个控制页面各自记录基准', () => {
    const storage = sharedStorage();
    const pages = Array.from({ length: 3 }, () => createPage('control', storage));
    for (const page of pages) page.restart(100);
    for (const page of pages) page.restart(200);
    assert.deepEqual(pages.map(page => page.reloads), [1, 1, 1]);
});

test('Chromium 两个同源页面实际导航后获得清空媒体按钮', async t => {
    let revision = 1;
    const visits = { control: 0, display: 0 };
    const server = http.createServer((req, res) => {
        if (!['/control', '/display'].includes(req.url)) {
            res.writeHead(404);
            res.end();
            return;
        }
        const role = req.url === '/control' ? 'control' : 'display';
        visits[role] += 1;
        const $ = cheerio.load(fs.readFileSync(path.join(publicDir, role === 'control' ? 'upload.html' : 'display.html'), 'utf8'));
        $('script, link').remove();
        if (revision === 1) $('#floatingClearMediaBtn').remove();
        const runtime = role === 'control'
            ? `${controlSource}\nwindow.receive = data => window.WebSocketManager.handleMessage(data);`
            : displayRuntime;
        $('body').append(`<script>${runtime}</script>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end($.html());
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    t.after(() => browser.close());
    const url = `http://127.0.0.1:${server.address().port}`;
    const pages = { control: await browser.newPage(), display: await browser.newPage() };
    for (const role of ['control', 'display']) {
        await pages[role].goto(`${url}/${role}`);
        await pages[role].evaluate(() => {
            localStorage.setItem('serverStartTime', '50');
            localStorage.setItem('chatTarget', '小爱');
            window.receive({ type: 'serverStartTime', time: 100 });
        });
    }
    assert.equal(await pages.control.$('#floatingClearMediaBtn'), null);
    revision = 2;
    for (const role of ['display', 'control']) {
        await Promise.all([
            pages[role].waitForNavigation({ waitUntil: 'load' }),
            pages[role].evaluate(() => window.receive({ type: 'serverStartTime', time: 200 }))
        ]);
        await pages[role].evaluate(() => window.receive({ type: 'serverStartTime', time: 200 }));
    }
    assert.ok(await pages.control.$('#floatingClearMediaBtn'));
    assert.equal(visits.control, 2);
    assert.equal(visits.display, 2);
    assert.equal(await pages.control.evaluate(() => localStorage.getItem('chatTarget')), '小爱');
});
