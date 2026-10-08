'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer');

const root = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(), '/usr/bin/chromium']
    .find(file => file && fs.existsSync(file));

test('保存屏幕光照后刷新保留完整viewport与角色像素，正式分类展开并保存独立采样步数', {
    skip: !chrome || !fs.existsSync(path.join(root, 'mmd/miya/miya.pmx')), timeout: 120000
}, async () => {
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1) || 'index.html';
        const file = path.resolve(root, relative === 'api/mmd/resources' ? 'mmd-resources.json' : relative);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.json': 'application/json' };
        response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: chrome, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage(); await page.setViewport({ width: 480, height: 640 });
        const failures = [];
        page.on('pageerror', error => failures.push(error.message));
        page.on('console', message => { if (message.type() === 'error' && /shader|webgl|compile|linkprogram/iu.test(message.text())) failures.push(message.text()); });
        await page.evaluateOnNewDocument(() => {
            const key = 'aasc.mmdArTest.screenLighting.v1';
            if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ contactEnabled: true, giEnabled: true, quality: 'low', giBlurPassCount: 0 }));
        });
        const ready = async () => {
            await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 45000 });
            await page.evaluate(async () => { for (let i = 0; i < 6; i += 1) await new Promise(resolve => requestAnimationFrame(resolve)); });
        };
        const checkPicture = async () => {
            const state = await page.evaluate(() => {
                const { renderer, ambientOcclusion, THREE } = window.DisplayMmd.getEditorBridge().context;
                ambientOcclusion.render();
                const gl = renderer.getContext();
                const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
                gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                let visiblePixels = 0;
                for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 127) visiblePixels += 1;
                return { viewport: renderer.getViewport(new THREE.Vector4()).toArray(), visiblePixels, error: gl.getError() };
            });
            assert.deepEqual(state.viewport, [0, 0, 480, 640], '离屏pass结束后不得缩小主画布全局viewport');
            assert.ok(state.visiblePixels > 1000, `角色必须实际绘制，而非仅modelReady：${state.visiblePixels}`);
            assert.equal(state.error, 0);
        };
        await page.goto(`http://127.0.0.1:${server.address().port}/?safePhysics=1`, { waitUntil: 'domcontentloaded' });
        await ready(); await checkPicture();
        await page.click('#displayMmdLightingToggle');
        assert.equal(await page.$eval('#displayMmdLightingPanel', node => node.hidden), false, '灯光按钮应打开正式面板');
        await page.click('#mmdArContactLighting [data-group-title="接触阴影"]');
        assert.equal(await page.$eval('#mmdArContactLightingBody', node => node.hidden), false);
        await page.$eval('[data-screen-lighting="contactStepCount"]', node => {
            node.value = '64'; node.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.click('#mmdArIndirectLighting [data-group-title="间接光"]');
        await page.click('#mmdArSsgi [data-group-title="SSGI"]');
        assert.equal(await page.$eval('#mmdArSsgiBody', node => node.hidden), false);
        assert.equal(await page.$eval('.display-mmd-lighting-header', node => node.querySelector('#mmdArScreenLighting') === null), true);
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await checkPicture();
        assert.equal(await page.evaluate(() => window.MmdArScreenLighting.contactStepCount), 64);
        assert.equal(await page.evaluate(() => window.MmdArScreenLighting.quality), 'low');
        // 高DPI仍使用目标自身的物理像素viewport，主画布逻辑尺寸不得被倍乘或缩小。
        await page.setViewport({ width: 480, height: 640, deviceScaleFactor: 2 });
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await checkPicture();
        assert.equal(await page.evaluate(() => window.DisplayMmd.getEditorBridge().context.renderer.getContext().drawingBufferWidth), 960);
        assert.deepEqual(failures, [], '首次加载与刷新不得出现GPU或页面错误');
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});
