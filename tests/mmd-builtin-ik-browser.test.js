'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const formal = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js');

test('MMD-AR真实米娅加载正式Human与同一内置IK模板，实际抬手、时钟暂停及取消释放', {
    timeout: 120000, skip: !fs.existsSync('/usr/bin/chromium') || !fs.existsSync(path.join(root, 'index.html'))
}, async () => {
    const errors = [];
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1) || 'index.html';
        // 仅测试服务覆盖Human装配；正式模板原样提供，不改变独立实验页的默认实现或产物。
        const alias = relative === 'js/web-human-interface.mjs' ? 'mmd-human-interface.mjs'
            : relative.startsWith('js/mmd-') ? relative.slice(3) : null;
        const directory = alias ? formal : root, file = path.resolve(directory, alias || relative);
        if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        response.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html',
            '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
            ignoreDefaultArgs: ['--disable-dev-shm-usage'], args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage(); await page.setViewport({ width: 540, height: 640 });
        page.on('pageerror', error => errors.push(error.message));
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('aasc.mmdArTest.render.v1', JSON.stringify({ canvasScale: 0.25, taaEnabled: false }));
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.DisplayMmd?.setLighting);
        await page.evaluate(() => window.DisplayMmd.setLighting({ pmxAoEnabled: false, keyShadowEnabled: false, shadowSource: 'none' }));
        await page.waitForFunction(() => { const h = window.DisplayMmd?.getHumanInterface();
            return h?.getState().ready && !h.getState().automaticMotionBlocked; }, { timeout: 90000 });
        const initial = await page.evaluate(async () => {
            const h = window.DisplayMmd.getHumanInterface();
            window.DisplayMmd.setMotionPlaybackEnabled(false);
            const hand = h.getInteractiveIKState().controls.find(c => c.key === 'leftHand');
            window.builtinClock = 0;
            const prepared = await h.prepare({ action: '比心', duration: 4, strength: 0.7, owner: 'test:builtin' });
            const request = h.startPrepared(prepared, { owner: 'test:builtin', clock: () => window.builtinClock });
            return { y: hand.achieved[1], id: request.id, source: JSON.parse(h.mpl.advancedSource({ name: '比心' })).format };
        });
        assert.equal(initial.source, 'ik-targets');
        await page.evaluate(() => { window.builtinClock = 2; });
        await page.waitForFunction(y => window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls
            .find(c => c.key === 'leftHand').achieved[1] > y + 0.4, { timeout: 30000 }, initial.y);
        const held = await page.evaluate(id => window.DisplayMmd.getHumanInterface().getRequest(id).time, initial.id);
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(await page.evaluate(id => window.DisplayMmd.getHumanInterface().getRequest(id).time, initial.id), held);
        await page.screenshot({ path: '/tmp/aasc-mmd-ar-builtin-ik.png' });
        assert.equal(await page.evaluate(id => {
            const h = window.DisplayMmd.getHumanInterface(); h.stop('test:builtin'); return h.getRequest(id).active;
        }, initial.id), false);
        assert.deepEqual(errors, []);
    } finally {
        server.closeAllConnections();
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
});
