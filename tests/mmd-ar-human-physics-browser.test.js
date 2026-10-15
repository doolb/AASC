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

// 按实际物理子步计时，低帧率也必须真正运行10秒物理，再观察最后1秒全部控制点。
async function sampleMotion(page, phase) {
    try { return await page.evaluate(async () => {
        const api = window.DisplayMmd.getHumanInterface(), samples = [];
        const started = performance.now(); let steps = 0, frames = 0;
        while (steps < 900) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            const state = api.getInteractiveIKState(); steps += state.physics.substeps; frames++;
            if (performance.now() - started > 150000) throw new Error('物理采样未完成：' + JSON.stringify({ steps, frames, state }));
            if (steps >= 810) samples.push(state.controls.map(item => item.achieved));
        }
        const final = samples.at(-1), state = api.getInteractiveIKState();
        const head = state.controls.find(item => item.key === 'head').achieved;
        const foot = state.controls.find(item => item.key === 'rightFoot').achieved;
        const height = Math.max(0.1, Math.abs(head[1] - foot[1]));
        let span = 0;
        for (const sample of samples) sample.forEach((point, index) => {
            span = Math.max(span, Math.hypot(...point.map((value, axis) => value - final[index][axis])) / height);
        });
        return { span, steps, samples: samples.length, activeTargets: state.activeTargets, gravity: state.settings.gravity,
            markersFollow: state.controls.filter(item => item.positionState === 'Off').every(item =>
                Math.hypot(...item.target.map((value, index) => value - item.achieved[index])) < 1e-6) };
    }); } catch (error) { throw new Error(phase + '：' + error.message); }
}

test('真实米娅默认关重力、实际拖点与Off释放稳定、多目标和模式/重置回归', {
    skip: !fs.existsSync(CHROME) || !fs.existsSync(path.join(ROOT, 'index.html')), timeout: 600000
}, async t => {
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
        // 此用例验证真实蒙皮/物理和指针，不评测灯光。SwiftShader关闭昂贵画面效果，保留原服饰物理。
        await page.evaluate(() => {
            const groups = window.MmdArLightingPresetGroups;
            groups.lighting.apply({ ...groups.lighting.read(), pmxAoEnabled: false, shadowSource: 'none', keyShadowEnabled: false });
            groups.screenLighting.apply({ ...groups.screenLighting.read(), giEnabled: false, contactEnabled: false });
            groups.render.apply({ ...groups.render.read(), aaMode: 'taa', taaEnabled: false, canvasScale: 0.25 });
        });
        await page.click('#mmdArIKToggle');
        await page.waitForFunction(() => !document.getElementById('mmdArIKPanel').hidden);
        assert.equal(await page.$eval('#mmdArIKToggle', element => element.getAttribute('aria-expanded')), 'true');
        assert.equal(await page.$eval('#mmdArHumanPanel', element => element.querySelectorAll('[data-body], [data-human-ik-status]').length), 0);
        await page.evaluate(async () => {
            window.DisplayMmd.setMotionPlaybackEnabled(false);
            const api = window.DisplayMmd.getHumanInterface();
            await api.physiology.set({ breathing: false, blinking: false });
            await api.gaze.set({ head: false, eyes: false });
        });
        await page.select('#mmdArIKPanel [data-body="mode"]', 'physics');
        await page.waitForFunction(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().mode === 'physics', { timeout: 20000 });
        await page.waitForFunction(() => !document.querySelector('#mmdArIKPanel [data-ik-action="enable"]').disabled);
        await page.click('#mmdArIKPanel [data-ik-action="enable"]');
        const initial = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState());
        assert.equal(initial.available, true, initial.reason); assert.equal(initial.targets, 11); assert.ok(initial.physics.bodyCount >= 15);
        assert.equal(initial.settings.strength, 0.85); assert.equal(initial.markerDiameter, 32);
        assert.equal(await page.$$eval('[data-damping-part]', fields => fields.length), 10);
        const displayed = await page.$$eval('[data-damping-part]', fields => Object.fromEntries(fields.map(field => [field.dataset.dampingPart, Number(field.value)])));
        assert.deepEqual(displayed, initial.settings.dampingMultipliers);
        assert.ok(displayed.pelvis > displayed.wrist);
        await page.$eval('[data-body="damping-parts"]', details => { details.open = true; });
        await page.$eval('[data-damping-part="wrist"]', field => {
            field.focus(); field.value = '0.6'; field.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelector('[data-damping-output="wrist"]').textContent === '0.60×'
            && window.DisplayMmd.getHumanInterface().getInteractiveIKState().settings.dampingMultipliers.wrist === 0.6);
        await page.$eval('[data-damping-part="head"]', field => {
            field.focus(); field.value = '1.6'; field.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const changed = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().settings.dampingMultipliers);
        assert.equal(changed.wrist, 0.6); assert.equal(changed.head, 1.6); assert.equal(changed.knee, displayed.knee);
        await page.click('[data-body="reset-damping"]');
        assert.deepEqual(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().settings.dampingMultipliers), displayed);
        assert.deepEqual(await page.$$eval('[data-damping-part]', fields => Object.fromEntries(fields.map(field => [field.dataset.dampingPart, Number(field.value)]))), displayed);
        await page.$eval('[data-body="damping-parts"]', details => { details.open = false; });
        assert.equal(initial.settings.gravity, false);
        assert.equal(await page.$eval('[data-body="gravity"]', element => element.checked), false);
        await page.$eval('[data-ik-size]', element => { element.value = '40'; element.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.equal(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().markerDiameter), 40);
        await page.$eval('[data-ik-size]', element => { element.value = '32'; element.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.click('#mmdArIKClose');
        assert.equal(await page.$eval('#mmdArIKPanel', element => element.hidden), true);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().enabled), true);
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
        const stability = await sampleMotion(page, '保持目标');
        t.diagnostic('保持目标采样完成：' + JSON.stringify(stability));
        assert.equal(stability.activeTargets, 1, '持续稳定测试必须为单点');
        assert.ok(stability.samples > 3 && stability.span < 0.025, '真实页面未牵引部位持续漂摆：' + JSON.stringify(stability));
        await page.click('#mmdArIKToggle');
        await page.select('[data-body="target"]', marker.key);
        await page.select('[data-body="positionState"]', 'Off');
        const released = await sampleMotion(page, '关重力Off');
        t.diagnostic('关重力Off采样完成：' + JSON.stringify(released));
        assert.equal(released.activeTargets, 0); assert.equal(released.gravity, false); assert.equal(released.markersFollow, true);
        assert.ok(released.span < 0.005, '真实页面Off后仍持续漂摆：' + JSON.stringify(released));
        await page.click('[data-body="gravity"]');
        const gravityReleased = await sampleMotion(page, '开重力Off');
        assert.equal(gravityReleased.gravity, true); assert.equal(gravityReleased.activeTargets, 0);
        assert.equal(gravityReleased.markersFollow, true);
        assert.ok(gravityReleased.span < 0.02, '真实页面开重力全Off持续乱摆：' + JSON.stringify(gravityReleased));
        await page.click('[data-body="gravity"]'); await page.click('#mmdArIKClose');
        t.diagnostic('真实网页Off/重力开启摆幅占身高：' + released.span.toFixed(5) + '/' + gravityReleased.span.toFixed(5));
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
        await page.click('#mmdArIKToggle');
        assert.equal(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().activeTargets), after.activeTargets);
        await page.click('#mmdArIKPanel [data-ik-action="reset"]');
        assert.equal(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().activeTargets), 0);
        assert.deepEqual(await page.$$eval('#mmdArIKPanel [data-body="mode"] option', options => options.map(option => option.value)), ['physics']);
        // 页面暂时屏蔽PBD；底层切换仍保留，供将来恢复及生命周期回归。
        await page.evaluate(() => window.DisplayMmd.getHumanInterface().setInteractiveIKMode('pbd'));
        await page.waitForFunction(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().mode === 'pbd');
        const pbd = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState());
        assert.equal(pbd.physics, null); assert.equal(pbd.targets, 7);
        await page.waitForFunction(() => !document.querySelector('#mmdArIKPanel [data-ik-action="enable"]').disabled);
        await page.click('#mmdArIKPanel [data-ik-action="enable"]');
        assert.equal(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().enabled), false);
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('#mmdArIKPanel', element => element.hidden), true);
        for (const viewport of [{ width: 540, height: 800 }, { width: 800, height: 540 }]) {
            await page.setViewport(viewport); await page.click('#mmdArIKToggle');
            const bounds = await page.$eval('#mmdArIKPanel', element => { const b = element.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; });
            assert.ok(bounds.left >= -1 && bounds.right <= viewport.width + 1 && bounds.top >= -1 && bounds.bottom <= viewport.height + 1, JSON.stringify(bounds));
            await page.click('#mmdArMotionToggle');
            assert.equal(await page.$eval('#mmdArIKPanel', element => element.hidden), true);
            await page.click('#mmdArIKToggle');
            assert.equal(await page.$eval('#mmdArMotionPanel', element => element.hidden), true);
            await page.keyboard.press('Escape');
        }
        assert.deepEqual(errors, [], '真实模型或身体设置面板出现页面异常');
    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});
