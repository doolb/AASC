'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const formal = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js');

test('MMD-AR真实米娅同一内置IK模板，抬手/重心切换/屈膝及脚锚定、暂停与取消', {
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
            const controls = h.getInteractiveIKState().controls.map(c => ({ key: c.key, position: c.achieved }));
            window.builtinClock = 0;
            const prepared = await h.prepare({ action: '比心', duration: 4, strength: 0.7, owner: 'test:builtin' });
            const request = h.startPrepared(prepared, { owner: 'test:builtin', clock: () => window.builtinClock });
            return { y: hand.achieved[1], id: request.id, controls,
                source: JSON.parse(h.mpl.advancedSource({ name: '比心' })).format };
        });
        assert.equal(initial.source, 'ik-targets');
        await page.evaluate(() => { window.builtinClock = 1.52; });
        await page.waitForFunction(y => window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls
            .find(c => c.key === 'leftHand').achieved[1] > y + 0.4, { timeout: 30000 }, initial.y);
        const held = await page.evaluate(id => window.DisplayMmd.getHumanInterface().getRequest(id).time, initial.id);
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(await page.evaluate(id => window.DisplayMmd.getHumanInterface().getRequest(id).time, initial.id), held);
        const baseline = Object.fromEntries(initial.controls.map(c => [c.key, c.position]));
        const height = baseline.head[1] - Math.min(baseline.leftFoot[1], baseline.rightFoot[1]);
        const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index])) * 1.6 / height;
        await page.waitForFunction(({ baseline, height }) => {
            const pelvis = window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls.find(c => c.key === 'pelvis').achieved;
            return Math.hypot(...pelvis.map((value, index) => value - baseline[index])) * 1.6 / height > 0.002;
        }, { timeout: 30000 }, { baseline: baseline.pelvis, height });
        const sway = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls.map(c => ({ key: c.key, position: c.achieved })));
        for (const c of sway.filter(c => /Foot$/u.test(c.key))) assert.ok(distance(c.position, baseline[c.key]) < 0.012, c.key + '重心切换时滑动过大');
        await page.screenshot({ path: '/tmp/aasc-mmd-ar-builtin-ik.png' });
        assert.equal(await page.evaluate(id => {
            const h = window.DisplayMmd.getHumanInterface(); h.stop('test:builtin'); return h.getRequest(id).active;
        }, initial.id), false);
        const bounceId = await page.evaluate(async () => {
            const h = window.DisplayMmd.getHumanInterface(); window.builtinClock = 0;
            const prepared = await h.prepare({ action: '庆祝', duration: 4, strength: 0.7, owner: 'test:lower' });
            return h.startPrepared(prepared, { owner: 'test:lower', clock: () => window.builtinClock }).id;
        });
        await page.evaluate(() => { window.builtinClock = 1.52; });
        await page.waitForFunction(({ baseline, height }) => {
            const knee = window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls.find(c => c.key === 'leftKnee').achieved;
            return Math.hypot(...knee.map((value, index) => value - baseline[index])) * 1.6 / height > 0.003;
        }, { timeout: 30000 }, { baseline: baseline.leftKnee, height });
        const bounce = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls.map(c => ({ key: c.key, position: c.achieved })));
        for (const c of bounce.filter(c => /Foot$/u.test(c.key))) assert.ok(distance(c.position, baseline[c.key]) < 0.012, c.key + '屈膝时滑动过大');
        await page.screenshot({ path: '/tmp/aasc-mmd-ar-lowerbody-ik.png' });
        fs.writeFileSync('/tmp/aasc-mmd-ar-lowerbody-ik.json', JSON.stringify({ baseline, sway, bounce, height }, null, 2));
        assert.equal(await page.evaluate(id => {
            const h = window.DisplayMmd.getHumanInterface(); h.stop('test:lower'); return h.getRequest(id).active;
        }, bounceId), false);
        assert.deepEqual(errors, []);
    } finally {
        server.closeAllConnections();
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
});
