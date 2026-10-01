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
        // 线框按物理有效质量着色：type0恒为0显示浅灰；正质量按对数色带（低端蓝、高端红）。
        assert.ok(active.massScale && active.massScale.min > 0 && active.massScale.max >= active.massScale.min);
        assert.deepEqual(active.massRamp, [0x3b82f6, 0x22d3ee, 0x34d399, 0xfacc15, 0xff5a5a]);
        const zeroMass = active.massBodies.filter(body => body.type === 0);
        assert.equal(zeroMass.length, active.counts[0]);
        assert.ok(zeroMass.length > 0 && zeroMass.every(body => body.effectiveMass === 0 && body.color === 0xd1d5db));
        const positive = active.massBodies.filter(body => body.effectiveMass > 0);
        assert.equal(positive.length, active.massBodies.length - zeroMass.length);
        assert.ok(positive.every(body => body.type !== 0 && body.color !== 0xd1d5db));
        const lightest = positive.reduce((a, b) => (a.effectiveMass <= b.effectiveMass ? a : b));
        const heaviest = positive.reduce((a, b) => (a.effectiveMass >= b.effectiveMass ? a : b));
        assert.equal(lightest.color, 0x3b82f6);
        assert.equal(heaviest.color, 0xff5a5a);
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
        const legend = await page.evaluate(() => ({
            hidden: document.getElementById('mmdArRigidBodyLegend').hidden,
            text: document.getElementById('mmdArRigidBodyMassRange').textContent,
            gradient: document.getElementById('mmdArRigidBodyLegend').querySelector('.mmd-ar-mass-bar').style.background,
        }));
        assert.equal(legend.hidden, false);
        assert.match(legend.text, /质量色阶（对数）：/u);
        assert.match(legend.gradient, /3b82f6|rgb\(59, 130, 246\)/u);
        assert.match(legend.gradient, /ff5a5a|rgb\(255, 90, 90\)/u);
        // 默认实体模式：样式按钮状态正确；线框/实体可切换并重建实例。
        assert.equal(active.displayMode, 'solid');
        assert.deepEqual(await page.evaluate(() => ({
            wireframe: document.querySelector('[data-rigid-body-style="wireframe"]').getAttribute('aria-pressed'),
            solid: document.querySelector('[data-rigid-body-style="solid"]').getAttribute('aria-pressed'),
        })), { wireframe: 'false', solid: 'true' });
        await page.click('[data-rigid-body-style="wireframe"]');
        assert.equal(await page.evaluate(() => window.DisplayMmd.getRigidBodyState().displayMode), 'wireframe');
        await page.click('[data-rigid-body-style="solid"]');
        await page.waitForFunction(() => window.DisplayMmd.getRigidBodyState().displayMode === 'solid'
            && window.DisplayMmd.getRigidBodyState().resourceGroups > 0);
        // 隐藏角色：不绘制角色网格，但碰撞体叠加继续渲染且不需要场景深度。
        const drawBeforeHide = await page.evaluate(() => window.DisplayMmd.getRigidBodyState().drawCount);
        await toggle('mmdArCharacterHiddenEnabled', true);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getRigidBodyState().characterHidden), true);
        await page.waitForFunction(count => window.DisplayMmd.getRigidBodyState().drawCount > count,
            { timeout: 15000 }, drawBeforeHide);
        await toggle('mmdArCharacterHiddenEnabled', false);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getRigidBodyState().characterHidden), false);
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
        // 刷新前改为非默认样式与隐藏角色，验证两者都本地恢复。
        await page.evaluate(() => document.querySelector('[data-rigid-body-style="wireframe"]').click());
        await toggle('mmdArCharacterHiddenEnabled', true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready();
        await waitDraw();
        assert.equal(await page.$eval('#mmdArRigidBodyEnabled', input => input.checked), true);
        assert.equal(await page.$eval('#mmdArSkeletonEnabled', input => input.checked), true);
        assert.equal((await state()).displayMode, 'wireframe');
        assert.equal((await state()).characterHidden, true);
        // 刷新后面板默认关闭，直接用DOM触发样式按钮与开关，不依赖可见性。
        await page.evaluate(() => document.querySelector('[data-rigid-body-style="solid"]').click());
        await toggle('mmdArCharacterHiddenEnabled', false);
        assert.equal((await state()).characterHidden, false);
        assert.equal((await state()).displayMode, 'solid');
        assert.deepEqual(errors, []);
        console.log(`碰撞体网页诊断 ${JSON.stringify({ bodyCount: active.bodyCount, counts: active.counts,
            resourceGroups: active.resourceGroups, geometries: active.geometries, baseFrameMs, overlayFrameMs,
            releasedGroupsBeforeRefresh: priorVmd.releasedGroups })}`);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
