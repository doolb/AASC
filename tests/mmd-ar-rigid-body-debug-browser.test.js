'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = '/usr/bin/chromium';

test('真实PMX线框、骨骼独立开关、实际/预览姿态、AO与PMX/VMD切换和刷新', {
    skip: !fs.existsSync(CHROME) || !fs.existsSync(path.join(ROOT, 'index.html')), timeout: 360000
}, async () => {
    const errors = [];
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname.slice(1)) || 'index.html';
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        response.setHeader('Content-Type', /\.m?js$/u.test(file) ? 'text/javascript'
            : /\.html$/u.test(file) ? 'text/html' : /\.css$/u.test(file) ? 'text/css' : 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
        const page = await browser.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 390, height: 844 });
        const url = `http://127.0.0.1:${server.address().port}/`;
        const ready = async () => {
            await page.waitForFunction(() => window.DisplayMmd?.setLighting);
            await page.evaluate(() => window.DisplayMmd.setLighting({ pmxAoEnabled: false, keyShadowEnabled: false }));
            await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 90000 });
        };
        const state = () => page.evaluate(() => window.DisplayMmd.getRigidBodyState());
        const toggle = (id, enabled) => page.evaluate(({ id, enabled }) => {
            const input = document.getElementById(id);
            input.checked = enabled;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, { id, enabled });
        const waitDraw = (mode = 'physics') => page.waitForFunction(value => {
            const state = window.DisplayMmd.getRigidBodyState();
            return state.poseMode === value && state.resourceGroups > 0;
        }, { timeout: 15000 }, mode);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await ready();
        const initial = await state();
        assert.equal(initial.enabled, false);
        assert.equal(initial.bodyCount, 183);
        assert.equal(initial.resourceGroups, 0);
        await toggle('mmdArRigidBodyEnabled', true);
        await waitDraw();
        const active = await state();
        assert.equal(active.actualCount, 183);
        for (const [type, color] of [[0, 0xff3333], [2, 0xffd633], [1, 0x33e066]]) {
            assert.ok(active.samples.some(sample => sample.type === type && sample.color === color));
        }
        // 默认米娅只有盒与胶囊；球体由真实Three/Ammo模块用例覆盖，不假定每个PMX包含全部形状。
        assert.ok(active.samples.some(sample => sample.shape === 'box'));
        assert.ok(active.samples.some(sample => sample.shape.startsWith('capsule:')));
        assert.equal(await page.evaluate(() => window.DisplayMmd.getSkeletonState().enabled), false);
        await toggle('mmdArSkeletonEnabled', true);
        await page.waitForFunction(() => window.DisplayMmd.getSkeletonState().resourceGroups === 4);
        await page.screenshot({ path: path.join(os.tmpdir(), 'mmd-ar-rigid-body-debug.png') });
        await page.click('#mmdArMotionToggle');
        await page.click('#mmdArMotionPanel [data-group-title="骨骼"]');
        await page.waitForFunction(() => document.getElementById('mmdArRigidBodyStatus').textContent.includes('实际物理姿态'));
        const before = active.samples.map(sample => sample.matrix);
        await page.waitForFunction(old => window.DisplayMmd.getRigidBodyState().samples.some((sample, index) =>
            sample.matrix.some((value, component) => Math.abs(value - old[index][component]) > 1e-4)), { timeout: 10000 }, before);
        await page.evaluate(() => window.DisplayMmd.setMotionPlaybackEnabled(false));
        const measure = () => page.evaluate(async () => {
            const start = performance.now();
            for (let index = 0; index < 8; index += 1) await new Promise(requestAnimationFrame);
            return (performance.now() - start) / 8;
        });
        const overlayFrameMs = await measure();
        await toggle('mmdArRigidBodyEnabled', false);
        const off = await state();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal((await state()).drawCount, off.drawCount);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getSkeletonState().enabled), true);
        const baseFrameMs = await measure();
        await toggle('mmdArRigidBodyEnabled', true);
        const priorAo = (await state()).drawCount;
        await page.evaluate(() => window.DisplayMmd.setLighting({ pmxAoEnabled: true }));
        await page.waitForFunction(count => window.DisplayMmd.getRigidBodyState().drawCount > count, { timeout: 15000 }, priorAo);
        await page.evaluate(() => window.DisplayMmd.setLighting({ pmxAoEnabled: false }));

        assert.equal(await page.evaluate(() => window.DisplayMmd.setPhysicsEnabled(false)), true);
        await waitDraw('preview');
        await page.waitForFunction(() => document.getElementById('mmdArRigidBodyStatus').textContent.includes('未模拟'));
        assert.equal((await state()).actualCount, 0);
        assert.equal(await page.evaluate(() => window.DisplayMmd.setPhysicsEnabled(true)), true);
        await waitDraw();
        await page.evaluate(() => window.DisplayMmd.setMotionPlaybackEnabled(true));

        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'mmd-resources.json'), 'utf8'));
        const profile = manifest.resources[0];
        const pmx = path.resolve(ROOT, profile.modelUrl);
        const vmd = path.resolve(ROOT, profile.motionUrl);
        const textures = path.join(path.dirname(pmx), 'tex');
        const files = [pmx, ...fs.readdirSync(textures).map(name => path.join(textures, name))];
        for (let iteration = 0; iteration < 2; iteration += 1) {
            const prior = await state();
            const input = await page.$('#mmdArLocalFiles');
            await input.evaluate(element => { element.value = ''; });
            await input.uploadFile(...files);
            await page.waitForFunction(generation => window.DisplayMmd.getRigidBodyState().generation > generation
                && !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 }, prior.generation);
            await waitDraw();
            const next = await state();
            assert.equal(next.enabled, true);
            assert.equal(next.bodyCount, 183);
            assert.equal(next.resourceGroups, prior.resourceGroups);
            assert.equal(next.geometries, prior.geometries);
            assert.equal(next.releasedGroups - prior.releasedGroups, prior.resourceGroups);
        }
        const priorVmd = await state();
        await (await page.$('#mmdArLocalVmd')).uploadFile(vmd);
        await page.waitForFunction(() => !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 });
        assert.equal((await state()).releasedGroups, priorVmd.releasedGroups);
        assert.equal((await state()).resourceGroups, priorVmd.resourceGroups);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready();
        await waitDraw();
        assert.equal(await page.$eval('#mmdArRigidBodyEnabled', input => input.checked), true);
        assert.equal(await page.$eval('#mmdArSkeletonEnabled', input => input.checked), true);
        assert.deepEqual(errors, []);
        console.log(`碰撞体网页诊断 ${JSON.stringify({ bodyCount: active.bodyCount, counts: active.counts,
            resourceGroups: active.resourceGroups, geometries: active.geometries, baseFrameMs, overlayFrameMs,
            releasedGroupsBeforeRefresh: priorVmd.releasedGroups })}`);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
