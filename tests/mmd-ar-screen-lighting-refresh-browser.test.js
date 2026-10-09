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

test('刷新保留角色和独立采样设置，正式分类可展开，真实模型接触阴影覆盖内部', {
    skip: !chrome || !fs.existsSync(path.join(root, 'mmd/miya/miya.pmx')),
    timeout: process.env.MMD_AR_SLOW_GPU === '1' ? 480000 : process.env.MMD_AR_COMPARE_BASELINE === '1' ? 240000 : 120000
}, async context => {
    let baseline = false;
    const baselineFiles = new Map();
    if (process.env.MMD_AR_COMPARE_BASELINE === '1') {
        const { execFileSync } = require('node:child_process');
        for (const file of ['web-screen-lighting.mjs', 'web-screen-lighting-shader.mjs', 'web-screen-lighting-panel.mjs']) {
            baselineFiles.set(`js/${file}`, execFileSync('git', ['show', `aee7d27b:3rd/mmd-ar-test/${file}`],
                { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }));
        }
    }
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1) || 'index.html';
        const file = path.resolve(root, relative === 'api/mmd/resources' ? 'mmd-resources.json' : relative);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.json': 'application/json' };
        response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        if (baseline && baselineFiles.has(relative)) { response.end(baselineFiles.get(relative)); return; }
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
            // 本用例验证渲染与存储，避免Ammo初始化占用软件GPU测试的启动预算。
            localStorage.setItem('aasc.mmdArTest.physicsEnabled.v1', 'false');
            const key = 'aasc.mmdArTest.screenLighting.v1';
            if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ contactEnabled: true, giEnabled: true, quality: 'low', giBlurPassCount: 0 }));
        });
        const ready = async () => {
            try { await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 45000 }); }
            catch (error) {
                context.diagnostic(`模型加载失败诊断：${JSON.stringify({ errors: failures, page: await page.evaluate(() => ({ state: window.DisplayMmd?.getState(), text: document.body.innerText.slice(-1600) })) })}`);
                throw error;
            }
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
        await page.$eval('[data-screen-lighting="contactBlurPassCount"]', node => {
            node.value = '3'; node.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.$eval('[data-screen-lighting="contactBlurRadius3"]', node => {
            node.value = '4'; node.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.equal(await page.$eval('[data-contact-blur-round="3"]', node => node.hidden), false);
        await page.click('#mmdArIndirectLighting [data-group-title="间接光"]');
        await page.click('#mmdArSsgi [data-group-title="SSGI"]');
        assert.equal(await page.$eval('#mmdArSsgiBody', node => node.hidden), false);
        assert.equal(await page.$eval('.display-mmd-lighting-header', node => node.querySelector('#mmdArScreenLighting') === null), true);
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await checkPicture();
        assert.equal(await page.evaluate(() => window.MmdArScreenLighting.contactStepCount), 64);
        assert.equal(await page.evaluate(() => window.MmdArScreenLighting.contactBlurPassCount), 3);
        assert.deepEqual(await page.evaluate(() => [...window.MmdArScreenLighting.contactBlurRadii]), [3, 3, 4]);
        assert.equal(await page.evaluate(() => window.MmdArScreenLighting.quality), 'low');
        // 高DPI仍使用目标自身的物理像素viewport，主画布逻辑尺寸不得被倍乘或缩小。
        await page.setViewport({ width: 480, height: 640, deviceScaleFactor: 2 });
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await checkPicture();
        assert.equal(await page.evaluate(() => window.DisplayMmd.getEditorBridge().context.renderer.getContext().drawingBufferWidth), 960);
        // 按用户反馈的强度1/距离3/30步和固定近景验证内部遮挡；旧追踪只会加深脖子的边缘。
        await page.setViewport({ width: 768, height: 752, deviceScaleFactor: 1 });
        // resize有节流，必须等待物理画布同步；否则固定坐标会误读上一尺寸的像素。
        await page.waitForFunction(() => {
            const gl = window.DisplayMmd.getEditorBridge().context.renderer.getContext();
            return gl.drawingBufferWidth === 768 && gl.drawingBufferHeight === 752;
        });
        const interior = await page.evaluate(async () => {
            const bridge = window.DisplayMmd.getEditorBridge(), c = bridge.context;
            c.helper.enable('physics', false); c.helper.enable('animation', false);
            bridge.rest();
            bridge.setCameraView({ position: [0, 16.5, 18.5], quaternion: [0, 0, 0, 1] });
            for (let i = 0; i < 3; i += 1) await new Promise(resolve => requestAnimationFrame(resolve));
            const capture = (enabled, rounds = 1) => {
                window.MmdArScreenLighting = { ...window.MmdArScreenLighting, contactEnabled: enabled, giEnabled: false,
                    contactStrength: 1, contactDistance: 3, contactStepCount: 30, contactBlurPassCount: rounds, contactBlurRadii: [3, 3, 3] };
                c.ambientOcclusion.render();
                const gl = c.renderer.getContext(), pixels = new Uint8Array(768 * 752 * 4);
                gl.readPixels(0, 0, 768, 752, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                const average = (x, y) => {
                    let sum = 0;
                    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
                        const index = ((751 - y - dy) * 768 + x + dx) * 4;
                        sum += pixels[index] * .2126 + pixels[index + 1] * .7152 + pixels[index + 2] * .0722;
                    }
                    return sum / 81;
                };
                return { neck: average(380, 425), clearChest: average(385, 508) };
            };
            const result = { off: capture(false), unfiltered: capture(true, 0), threeRounds: capture(true, 3), on: capture(true, 1) };
            result.repeated = capture(true, 1); return result;
        });
        assert.ok(interior.on.neck < interior.off.neck * .85, `下巴遮挡内部应被阴影覆盖：${JSON.stringify(interior)}`);
        assert.ok(Math.abs(interior.on.clearChest - interior.off.clearChest) < 3, '无遮挡胸部不能被整体压暗');
        assert.ok(interior.unfiltered.neck < interior.off.neck * .97, '新追踪本身必须覆盖内部，不能依赖模糊扩散制造阴影');
        assert.ok(Math.abs(interior.threeRounds.clearChest - interior.off.clearChest) < 3);
        assert.deepEqual(interior.repeated, interior.on, '固定采样相位和当前帧滤波须保持静态结果一致');
        if (process.env.MMD_AR_SCREENSHOT_PATH) await page.screenshot({ path: process.env.MMD_AR_SCREENSHOT_PATH });
        context.diagnostic(`内部/无遮挡亮度对比：${JSON.stringify(interior)}`);
        if (baselineFiles.size > 0) {
            const measure = async () => page.evaluate(async isBaseline => {
                const bridge = window.DisplayMmd.getEditorBridge(), c = bridge.context;
                c.helper.enable('physics', false); c.helper.enable('animation', false); bridge.rest();
                bridge.setCameraView({ position: [0, 16.5, 18.5], quaternion: [0, 0, 0, 1] });
                const gl = c.renderer.getContext(), timings = [], completedPixel = new Uint8Array(4);
                for (const rounds of (isBaseline ? [0] : [0, 1])) for (const steps of [12, 30, 64]) {
                    window.MmdArScreenLighting = { ...window.MmdArScreenLighting, contactEnabled: true, giEnabled: false,
                        quality: 'low', contactStrength: 1, contactDistance: 3, contactStepCount: steps,
                        contactBlurPassCount: rounds, contactBlurRadii: [3, 3, 3] };
                    const samples = [];
                    for (let i = 0; i < 9; i += 1) {
                        gl.finish(); const begin = performance.now(); c.ambientOcclusion.render();
                        // Chrome命令提交可能仍异步；读回像素强制完成实际渲染，不能把提交时间当GPU耗时。
                        gl.readPixels(380, 326, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, completedPixel); gl.finish();
                        if (i > 1) samples.push(performance.now() - begin);
                        await new Promise(resolve => requestAnimationFrame(resolve));
                    }
                    samples.sort((a, b) => a - b);
                    if (completedPixel[3] < 127 || gl.getError() !== 0) throw new Error('性能采样必须实际绘制角色');
                    timings.push({ steps, rounds, median: Number(samples[3].toFixed(2)), p95: Number(samples[6].toFixed(2)) });
                }
                return timings;
            }, baseline);
            const optimized = await measure();
            baseline = true;
            await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
            const original = await measure();
            context.diagnostic(`受控软件GPU全部AO/光照pass含范围归约与滤波耗时(ms)：${JSON.stringify({ optimized, original })}`);
        }
        assert.deepEqual(failures, [], '首次加载与刷新不得出现GPU或页面错误');
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});
