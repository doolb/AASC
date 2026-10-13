'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');

const ROOT = process.env.AASC_MMD_TEST_WEB_ROOT || path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const MIME = new Map([
    ['.css', 'text/css'], ['.html', 'text/html'], ['.js', 'text/javascript'], ['.json', 'application/json'],
    ['.mjs', 'text/javascript'], ['.wasm', 'application/wasm']
]);

test('真实PMX画布在IK开启时接受反向环绕、双指平移/缩放及膝控制点', {
    skip: !fs.existsSync(CHROME) || !fs.existsSync(path.join(ROOT, 'index.html')),
    timeout: 240000
}, async () => {
    const errors = [];
    const server = http.createServer((request, response) => {
        const rawPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const pathname = rawPath === '/' ? '/index.html' : rawPath;
        const file = path.resolve(ROOT, '.' + pathname);
        if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        response.setHeader('Content-Type', MIME.get(path.extname(file)) || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            ignoreDefaultArgs: ['--disable-dev-shm-usage'],
            args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 540, height: 800 });
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.DisplayMmd?.getHumanInterface?.()?.getState().ready
            && window.DisplayMmd.getState().modelReady && window.DisplayMmd.getState().visible, { timeout: 180000 });
        const ik = await page.evaluate(() => {
            window.DisplayMmd.setMotionPlaybackEnabled(false);
            return window.DisplayMmd.getHumanInterface().setInteractiveIKEnabled(true);
        });
        assert.equal(ik.enabled, true);
        assert.ok(ik.targets >= 7, `真实 PMX 未创建七个头/手/膝/脚 IK 控制点：${ik.targets}`);
        const canvas = await page.$('#displayMmdCanvas');
        const bounds = await canvas.boundingBox();
        assert.ok(bounds && bounds.width > 100 && bounds.height > 100, 'MMD 画布没有可交互尺寸');

        const orbitStart = await canvas.screenshot();
        const x = Math.round(bounds.x + 12), y = Math.round(bounds.y + 12);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 75, y + 46, { steps: 5 });
        await page.mouse.up();
        await new Promise(resolve => setTimeout(resolve, 350));
        const orbitEnd = await canvas.screenshot();
        assert.notDeepEqual(orbitEnd, orbitStart, 'IK开启时空白处单指/左拖未改变镜头画面');

        const client = await page.createCDPSession();
        await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
        const panStart = await canvas.screenshot();
        const touchA = { x: Math.round(bounds.x + 22), y: Math.round(bounds.y + 180), id: 1, radiusX: 5, radiusY: 5, force: 1 };
        const touchB = { x: Math.round(bounds.x + 82), y: Math.round(bounds.y + 180), id: 2, radiusX: 5, radiusY: 5, force: 1 };
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchA, touchB] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
            { ...touchA, x: touchA.x + 24, y: touchA.y + 18 }, { ...touchB, x: touchB.x + 24, y: touchB.y + 18 }
        ] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
        await new Promise(resolve => setTimeout(resolve, 350));
        const panEnd = await canvas.screenshot();
        assert.notDeepEqual(panEnd, panStart, 'IK开启时双指中心移动未改变镜头画面');

        const zoomStart = await canvas.screenshot();
        await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchA, touchB] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
            { ...touchA, x: touchA.x - 18 }, { ...touchB, x: touchB.x + 18 }
        ] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
        await new Promise(resolve => setTimeout(resolve, 350));
        const zoomEnd = await canvas.screenshot();
        assert.notDeepEqual(zoomEnd, zoomStart, 'IK开启时双指捏合未改变镜头画面');
        assert.deepEqual(errors, [], '真实浏览器出现页面异常');
    } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
