'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const task = require('../src/apps/server/modules/task-engine/builtin-tasks/doubao-web');

const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');

test('豆包运行页正式widget点击：Android原生入口、旧APK、远端服务与失败提示', { timeout: 30000 }, async t => {
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<section id="panel-task"></section><main id="widget"></main>');
    for (const file of ['chat2api.js', 'task-panel.js']) {
        await page.addScriptTag({ path: path.join(publicDir, 'js', file) });
    }
    await page.evaluate(() => {
        window.calls = 0; window.messages = [];
        window.showToast = message => messages.push(message);
        window.NativeControl = { openDoubaoRuntimePage: () => { calls++; return true; } };
        window.WebSocketManager = { ws: { url: 'ws://127.0.0.1:8081' } };
    });
    const render = async platform => page.evaluate(({ widget, platform }) => {
        TaskPanel._widgetData['runtime-test'] = { runtimePlatform: platform, statusText: '运行中',
            accountText: '按当前请求选择', addressText: '127.0.0.1:9091' };
        document.getElementById('widget').innerHTML = TaskPanel._renderWidget(widget, 'runtime-test', 'doubao.web', 'running');
    }, { widget: task.widget, platform });
    await render('android');
    await page.click('#widget button');
    assert.equal(await page.evaluate(() => calls), 1);

    await render('desktop'); await page.click('#widget button');
    assert.match(await page.evaluate(() => messages.at(-1)), /桌面端.*专用浏览器/);
    await render('android');
    await page.evaluate(() => { NativeControl = {}; });
    await page.click('#widget button');
    assert.match(await page.evaluate(() => messages.at(-1)), /更新 APK/);

    await page.evaluate(() => { NativeControl.openDoubaoRuntimePage = () => { calls++; return false; }; });
    await page.click('#widget button');
    assert.equal(await page.evaluate(() => calls), 2);
    assert.match(await page.evaluate(() => messages.at(-1)), /未连接本机 Offline/);
    await page.evaluate(() => { WebSocketManager.ws.url = 'ws://192.168.1.39:8081'; });
    await page.click('#widget button');
    assert.equal(await page.evaluate(() => calls), 2);
    assert.match(await page.evaluate(() => messages.at(-1)), /连接手机本地服务/);

    await page.evaluate(() => {
        WebSocketManager.ws.url = 'ws://localhost:8081';
        NativeControl.openDoubaoRuntimePage = () => { throw new Error('模拟启动失败'); };
    });
    await page.click('#widget button');
    assert.match(await page.evaluate(() => messages.at(-1)), /打开运行页面失败.*模拟启动失败/);
    assert.deepEqual(errors, []);
});
