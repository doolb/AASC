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

test('真实网页骨骼显示、动作/物理更新、偏好恢复与PMX/VMD切换释放', {
    skip: !fs.existsSync(CHROME) || !fs.existsSync(path.join(ROOT, 'index.html')), timeout: 300000
}, async () => {
    const errors = [];
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname.slice(1)) || 'index.html';
        const absolute = path.resolve(ROOT, relative);
        if (!absolute.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
            response.writeHead(404).end();
            return;
        }
        response.setHeader('Content-Type', /\.m?js$/u.test(absolute) ? 'text/javascript'
            : /\.html$/u.test(absolute) ? 'text/html' : /\.css$/u.test(absolute) ? 'text/css' : 'application/octet-stream');
        fs.createReadStream(absolute).pipe(response);
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
        const state = () => page.evaluate(() => window.DisplayMmd.getSkeletonState());
        const toggle = enabled => page.evaluate(value => {
            const input = document.getElementById('mmdArSkeletonEnabled');
            input.checked = value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, enabled);
        const waitDraw = () => page.waitForFunction(() => window.DisplayMmd.getSkeletonState().resourceGroups === 4, { timeout: 10000 });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await ready();
        const initial = await state();
        assert.equal(initial.enabled, false);
        assert.equal(initial.resourceGroups, 0);
        assert.ok(initial.boneCount > 100);
        await toggle(true);
        await waitDraw();
        const active = await state();
        assert.equal(active.resourceGroups, 4);
        for (const [type, color] of [[0, 0xff3333], [2, 0xffd633], [1, 0x33e066], ['none', 0x9ca3af]]) {
            const sample = active.samples.find(value => value.type === type);
            assert.equal(sample.color, color);
            assert.ok(sample.position.every((value, index) => Math.abs(value - sample.bonePosition[index]) < 1e-4));
            assert.ok(active.counts[type] > 0);
        }
        const oldPositions = active.samples.map(value => value.position);
        await page.waitForFunction(previous => {
            const samples = window.DisplayMmd.getSkeletonState().samples;
            return samples.some((value, index) => value.position.some((axis, axisIndex) => Math.abs(axis - previous[index][axisIndex]) > 1e-4));
        }, { timeout: 10000 }, oldPositions);
        await page.screenshot({ path: path.join(os.tmpdir(), 'mmd-ar-skeleton-debug.png') });
        const measureFrames = () => page.evaluate(async () => {
            const start = performance.now();
            for (let index = 0; index < 8; index += 1) await new Promise(requestAnimationFrame);
            return (performance.now() - start) / 8;
        });
        const overlayFrameMs = await measureFrames();
        await toggle(false);
        const stopped = await state();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal((await state()).drawCount, stopped.drawCount);
        const baseFrameMs = await measureFrames();
        await toggle(true);
        const beforeAo = (await state()).drawCount;
        await page.evaluate(() => window.DisplayMmd.setLighting({ pmxAoEnabled: true }));
        await page.waitForFunction(previous => window.DisplayMmd.getSkeletonState().drawCount > previous,
            { timeout: 10000 }, beforeAo);
        await page.evaluate(() => window.DisplayMmd.setLighting({ pmxAoEnabled: false }));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready();
        await waitDraw();
        assert.equal(await page.$eval('#mmdArSkeletonEnabled', input => input.checked), true);
        await page.evaluate(() => window.DisplayMmd.setMotionPlaybackEnabled(false));
        await page.evaluate(() => window.DisplayMmd.setPhysicsEnabled(false));
        const paused = await state();
        assert.deepEqual(paused.counts, active.counts);
        await page.evaluate(() => window.DisplayMmd.setPhysicsEnabled(true));
        await page.evaluate(() => window.DisplayMmd.setMotionPlaybackEnabled(true));
        // 物理重载也重新提交模型；首帧隐藏时还未分配小球，等实际显示后再比较释放数量。
        await waitDraw();

        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'mmd-resources.json'), 'utf8'));
        const profile = manifest.resources[0];
        const pmx = path.resolve(ROOT, profile.modelUrl);
        const vmd = path.resolve(ROOT, profile.motionUrl);
        const directory = path.join(path.dirname(pmx), 'tex');
        const files = [pmx, ...fs.readdirSync(directory).map(name => path.join(directory, name))];
        for (let iteration = 0; iteration < 2; iteration += 1) {
            const before = await state();
            const input = await page.$('#mmdArLocalFiles');
            await input.evaluate(element => { element.value = ''; });
            await input.uploadFile(...files);
            await page.waitForFunction(generation => window.DisplayMmd.getSkeletonState().generation > generation
                && !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 }, before.generation);
            await waitDraw();
            const after = await state();
            assert.equal(after.enabled, true);
            assert.equal(after.resourceGroups, before.resourceGroups);
            assert.equal(after.releasedGroups - before.releasedGroups, before.resourceGroups);
            assert.deepEqual(after.counts, before.counts);
        }
        const beforeMotion = await state();
        await (await page.$('#mmdArLocalVmd')).uploadFile(vmd);
        await page.waitForFunction(() => !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 });
        const afterMotion = await state();
        assert.equal(afterMotion.generation, beforeMotion.generation);
        assert.equal(afterMotion.releasedGroups, beforeMotion.releasedGroups);
        assert.equal(afterMotion.enabled, true);
        assert.equal(afterMotion.resourceGroups, 4);
        assert.deepEqual(errors, []);
        console.log(`骨骼网页诊断 ${JSON.stringify({ boneCount: afterMotion.boneCount, counts: afterMotion.counts,
            generation: afterMotion.generation, resourceGroups: afterMotion.resourceGroups, releasedGroups: afterMotion.releasedGroups,
            baseFrameMs, overlayFrameMs })}`);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
