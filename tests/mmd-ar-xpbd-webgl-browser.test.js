'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = '/usr/bin/chromium';

test('生成网页可切换真实PMX到WebGL XPBD再切回CPU', {
    skip: !fs.existsSync(CHROME), timeout: 300000
}, async () => {
    const failures = [];
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).slice(1) || 'index.html';
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        const mime = { '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
            '.html': 'text/html', '.wasm': 'application/wasm' };
        response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage(); await page.setViewport({ width: 640, height: 640 });
        page.on('pageerror', error => failures.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        // 页面加载失败时直接输出现有错误/状态，而不把“文件有函数名”当运行时修复成功。
        try {
            await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 90000 });
        } catch (error) {
            assert.fail(JSON.stringify({ failures, state: await page.evaluate(() => window.DisplayMmd?.getState()),
                text: await page.evaluate(() => document.body.innerText.slice(-1800)) }));
        }
        console.log('PMX已加载，开始切换WebGL');
        await page.evaluate(async () => {
            window.DisplayMmd.setMotionPlaybackEnabled(false);
            window.DisplayMmd.setPhysicsStabilityReference(3);
            await window.DisplayMmd.setPhysicsSolver('xpbd-webgl');
        });
        console.log('切换返回', await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState()));
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState()?.readbacks >= 2 || window.DisplayMmd.getPhysicsSolverState()?.fallbackReason, { timeout: 90000 });
        const state = await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState());
        assert.equal(state.solver, 'xpbd-webgl', JSON.stringify(state));
        assert.equal(state.computeBackend, 'webgl2'); assert.equal(state.fallbackReason, '');
        assert.ok(state.bodyCount > 10); assert.ok(state.candidates > 0); assert.ok(state.jointColors > 0);
        console.log('真实PMX WebGL状态', JSON.stringify(state));
        await page.evaluate(() => window.DisplayMmd.setPhysicsSolver('xpbd'));
        assert.equal(await page.evaluate(() => window.DisplayMmd.getPhysicsSolver()), 'xpbd');
        assert.deepEqual(failures, []);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
