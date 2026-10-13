'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const ROOT = process.env.AASC_MMD_TEST_WEB_ROOT || path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const MIME = new Map([['.js', 'text/javascript'], ['.mjs', 'text/javascript'], ['.wasm', 'application/wasm'],
    ['.css', 'text/css'], ['.html', 'text/html'], ['.json', 'application/json']]);

test('真实米娅PMX启用人体物理、实际指针拖动、多目标和模式/重置回归', {
    skip: !fs.existsSync(CHROME) || !fs.existsSync(path.join(ROOT, 'index.html')), timeout: 300000
}, async () => {
    const errors = [], transportErrors = [], server = http.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const file = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
        response.setHeader('Content-Type', MIME.get(path.extname(file)) || 'application/octet-stream'); fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            ignoreDefaultArgs: ['--disable-dev-shm-usage'],
            args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
        const page = await browser.newPage(); await page.setViewport({ width: 540, height: 800 });
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', request => transportErrors.push(request.url() + ' ' + request.failure()?.errorText));
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        try {
            await page.waitForFunction(() => window.DisplayMmd?.getHumanInterface?.()?.getState().ready
                && window.DisplayMmd.getState().modelReady && window.DisplayMmd.getState().visible, { timeout: 180000 });
        } catch (error) { throw new Error(error.message + '\n页面异常：' + JSON.stringify(errors) + '\n资源失败：' + JSON.stringify(transportErrors)); }
        await page.waitForSelector('[data-body="mode"]');
        await page.evaluate(() => {
            window.DisplayMmd.setMotionPlaybackEnabled(false);
            const select = document.querySelector('[data-body="mode"]');
            select.value = 'physics'; select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().mode === 'physics', { timeout: 20000 });
        const initial = await page.evaluate(() => {
            const api = window.DisplayMmd.getHumanInterface();
            api.setInteractiveBodySettings({ gravity: false }); return api.setInteractiveIKEnabled(true);
        });
        assert.equal(initial.available, true, initial.reason); assert.equal(initial.targets, 11); assert.ok(initial.physics.bodyCount >= 15);
        // 页面物理与镜头仍在更新，紧邻按下读取真实标记，排除画布外和被面板覆盖的坐标。
        const marker = await page.evaluate(() => {
            const state = window.DisplayMmd.getHumanInterface().getInteractiveIKState();
            const controls = state.controls.filter(item => /Hand$/u.test(item.key) && item.screen?.visible
                && document.elementFromPoint(item.screen.x, item.screen.y)?.id === 'displayMmdCanvas');
            return controls.find(item => state.controls.every(other => other.key === item.key || !other.screen
                || Math.hypot(other.screen.x - item.screen.x, other.screen.y - item.screen.y) > 14)) || controls[0];
        });
        assert.ok(marker, '没有可见手部控制点');
        const input = await page.createCDPSession();
        await input.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: marker.screen.x, y: marker.screen.y, button: 'left', buttons: 1, clickCount: 1 });
        await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: marker.screen.x + 42, y: marker.screen.y - 30, button: 'left', buttons: 1 });
        await input.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: marker.screen.x + 42, y: marker.screen.y - 30, button: 'left', buttons: 0, clickCount: 1 });
        await input.detach();
        try {
            await page.waitForFunction(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().activeTargets > 0, { timeout: 15000 });
        } catch (error) {
            const state = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState());
            throw new Error(error.message + '\n按下标记：' + JSON.stringify(marker) + '\n物理状态：' + JSON.stringify(state));
        }
        const dragged = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState());
        assert.ok(dragged.controls.some(item => item.positionState === 'On'), '实际指针没有激活物理位置驱动');
        assert.ok(dragged.controls.some(item => item.target.some((value, i) => Math.abs(value - item.achieved[i]) > 1e-5)));
        const before = dragged.controls.map(item => item.achieved);
        await page.evaluate(() => {
            const api = window.DisplayMmd.getHumanInterface(), state = api.getInteractiveIKState();
            const foot = state.controls.find(item => item.key === 'leftFoot'), head = state.controls.find(item => item.key === 'head');
            const height = Math.max(0.1, head.achieved[1] - foot.achieved[1]);
            api.setInteractiveTarget('leftFoot', foot.achieved.map((value, i) => value + (i === 1 ? height * 0.15 : i === 2 ? height * 0.1 : 0)));
            api.setInteractiveTargetState('rightHand', 'Off', 'On');
            api.setInteractiveTarget('rightHand', null, [0, 0, Math.sin(0.2), Math.cos(0.2)]);
        });
        await page.waitForFunction(previous => {
            const state = window.DisplayMmd.getHumanInterface().getInteractiveIKState();
            return state.physics?.substeps > 0 && state.controls.some((item, index) =>
                item.achieved.some((value, axis) => Math.abs(value - previous[index][axis]) > 0.0001));
        }, { timeout: 20000 }, before);
        const after = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState());
        assert.equal(after.available, true, after.reason);
        assert.ok(after.controls.every(item => [...item.achieved, ...item.target, ...item.rotation].every(Number.isFinite)));
        assert.ok(after.activeTargets >= 2);
        const reset = await page.evaluate(() => window.DisplayMmd.getHumanInterface().resetInteractiveIK());
        assert.equal(reset.activeTargets, 0);
        const pbd = await page.evaluate(() => window.DisplayMmd.getHumanInterface().setInteractiveIKMode('pbd'));
        assert.equal(pbd.physics, null); assert.equal(pbd.targets, 7);
        await page.evaluate(() => window.DisplayMmd.getHumanInterface().setInteractiveIKEnabled(false));
        assert.deepEqual(errors, [], '真实模型或身体设置面板出现页面异常');
    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});
