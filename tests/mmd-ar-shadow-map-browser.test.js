'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = '/usr/bin/chromium';

test('真实PMX阴影尺寸/倍率/像素对齐、移动与缩放跟随、整图覆盖/保存复位及GPU资源回收', {
    skip: !fs.existsSync(CHROME) || !fs.existsSync(path.join(ROOT, 'index.html')), timeout: 480000
}, async () => {
    const failures = [];
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).slice(1) || 'index.html';
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        const mime = { '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm' };
        response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1000, height: 1100 });
        page.on('pageerror', error => failures.push(error.message));
        page.on('console', message => { if (message.type() === 'error' && /shader|webgl|compile/iu.test(message.text())) failures.push(message.text()); });
        const address = `http://127.0.0.1:${server.address().port}/`;
        await page.goto(address, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady && window.MmdArTestShadowMapDiagnostic, { timeout: 90000 });
        const frames = (count = 3) => page.evaluate(target => new Promise(resolve => {
            let seen = 0; const step = () => { if (++seen >= target) resolve(); else requestAnimationFrame(step); };
            requestAnimationFrame(step);
        }), count);
        const initial = await page.evaluate(() => window.MmdArTestShadowMapDiagnostic());
        assert.equal(initial.size, 1024); assert.equal(initial.preview.allocated, false); assert.equal(initial.preview.reads, 0);
        assert.equal(initial.cameraScale, 1);
        assert.equal(await page.$eval('#mmdArShadowCameraScale', node => node.value), '1');
        const checkGrid = state => {
            for (const map of state.maps) {
                if (!map.castShadow || !map.width) continue;
                for (const pixel of map.originPixel) assert.ok(Math.abs(pixel - Math.round(pixel)) < 1e-6,
                    `世界参考点必须落整像素：${JSON.stringify(map)}`);
            }
        };
        const cameraWidth = camera => camera.right - camera.left;
        // 通过真实控件改变设置，停下角色动作/物理便于稳定比较资源数。
        await page.evaluate(async () => {
            window.DisplayMmd.setMotionPlaybackEnabled(false);
            await window.DisplayMmd.setPhysicsEnabled(false);
            window.DisplayMmd.setLighting({ pmxAoEnabled: false, fillEnabled: true, shadowSource: 'fill', keyShadowEnabled: true });
            document.getElementById('displayMmdLightingToggle').click();
            document.querySelector('#displayMmdLightingPanel button[data-group-title="主光"]').click();
        });
        const chooseSize = async size => {
            await page.evaluate(value => {
                const input = document.getElementById('mmdArShadowMapSize');
                input.value = String(value); input.dispatchEvent(new Event('change', { bubbles: true }));
            }, size);
            try {
                await page.waitForFunction(value => {
                    const state = window.MmdArTestShadowMapDiagnostic();
                    return state.maps.every(map => map.width === value && map.height === value);
                }, { timeout: 45000 }, size);
            } catch (error) {
                assert.fail(JSON.stringify({ requested: size, state: await page.evaluate(() => window.MmdArTestShadowMapDiagnostic()), failures }));
            }
            const state = await page.evaluate(() => window.MmdArTestShadowMapDiagnostic());
            checkGrid(state);
            return state;
        };
        await chooseSize(512);
        // 新模型首帧隐藏用于物理初始化，角色材质贴图下一帧才上传；采样前等实际绘制稳定。
        await frames(4);
        const baseline = await page.evaluate(() => window.MmdArTestShadowMapDiagnostic());
        let stableTextureCount = baseline.memory.textures;
        const sizes = [];
        for (const size of [1024, 2048, 4096, 512, 2048, 512]) {
            const state = await chooseSize(size); sizes.push(state.size);
            // 原AO关闭后的资源可能延迟释放，数量可下降；尺寸切换不得积累贴图。
            assert.ok(state.memory.textures <= baseline.memory.textures,
                `尺寸${size}不应积累GPU贴图：${state.memory.textures} <= ${baseline.memory.textures}`);
            stableTextureCount = state.memory.textures;
        }
        assert.deepEqual(sizes, [1024, 2048, 4096, 512, 2048, 512]);
        await page.evaluate(() => {
            const toggle = document.getElementById('mmdArShadowMapPreviewEnabled');
            toggle.checked = true; toggle.dispatchEvent(new Event('change', { bubbles: true }));
            document.getElementById('mmdArShadowMapPreviewRows').scrollIntoView({ block: 'center' });
        });
        try {
            await page.waitForFunction(() => window.MmdArTestShadowMapDiagnostic().preview.reads >= 2, { timeout: 30000 });
        } catch (error) {
            const state = await page.evaluate(() => ({ diagnostic: window.MmdArTestShadowMapDiagnostic(),
                elements: ['displayMmdLightingPanel', 'mmdArShadowMapPreviewRows', 'mmdArShadowMapKeyCanvas'].map(id => {
                    const node = document.getElementById(id); const bounds = node.getBoundingClientRect();
                    return { id, hidden: node.hidden, display: getComputedStyle(node).display,
                        top: bounds.top, bottom: bounds.bottom, rects: node.getClientRects().length };
                }) }));
            assert.fail(JSON.stringify({ state, failures }));
        }
        const result = await page.evaluate(() => {
            const canvas = document.getElementById('mmdArShadowMapKeyCanvas');
            const data = canvas.getContext('2d').getImageData(0, 0, 256, 256).data;
            let dark = 0, white = 0;
            for (let i = 0; i < data.length; i += 4) { if (data[i] < 254) dark += 1; else white += 1; }
            return { dark, white, key: document.getElementById('mmdArShadowMapKeyStatus').textContent,
                fill: document.getElementById('mmdArShadowMapFillStatus').textContent,
                state: window.MmdArTestShadowMapDiagnostic() };
        });
        assert.ok(result.dark > 100 && result.white > 100, JSON.stringify(result));
        assert.match(result.key, /512 × 512.*角色像素覆盖约 [\d.]+%/u);
        assert.match(result.fill, /512 × 512.*角色像素覆盖约/u);
        assert.equal(result.state.preview.error, '');
        assert.equal(result.state.memory.textures, stableTextureCount + 1);
        // 倍率只改投影范围；等待预览更新后观察角色面积变化，贴图尺寸和资源数不变。
        const baseCameras = result.state.maps.map(map => map.camera);
        const cameraRange = async scale => {
            const previousReads = await page.evaluate(() => window.MmdArTestShadowMapDiagnostic().preview.reads);
            await page.evaluate(value => {
                const input = document.getElementById('mmdArShadowCameraScale');
                input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
            }, scale);
            await page.waitForFunction(({ scale, previousReads }) => {
                const state = window.MmdArTestShadowMapDiagnostic();
                return state.cameraScale === scale && state.preview.reads > previousReads;
            }, { timeout: 30000 }, { scale, previousReads });
            const state = await page.evaluate(() => window.MmdArTestShadowMapDiagnostic());
            for (let index = 0; index < state.maps.length; index += 1) {
                const map = state.maps[index]; const original = baseCameras[index];
                // 网格对齐会平移正交边界，倍率应验证总宽高，不能要求左右严格对称。
                assert.ok(Math.abs(cameraWidth(map.camera) - cameraWidth(original) * scale) < 1e-6);
                assert.ok(Math.abs(map.camera.top - map.camera.bottom - (original.top - original.bottom) * scale) < 1e-6);
                assert.equal(map.width, 512); assert.equal(map.height, 512);
                assert.equal(map.camera.near, original.near); assert.equal(map.camera.far, original.far);
            }
            checkGrid(state);
            assert.equal(state.memory.textures, result.state.memory.textures);
            return page.$eval('#mmdArShadowMapKeyStatus', node => Number(node.textContent.match(/约 ([\d.]+)%/u)[1]));
        };
        const wideCoverage = await cameraRange(2);
        const smallCoverage = await cameraRange(0.5);
        assert.ok(smallCoverage > wideCoverage, `收紧范围应提高覆盖率：${smallCoverage} > ${wideCoverage}`);
        await cameraRange(0.1);
        await cameraRange(1);
        await cameraRange(0.5);
        // 灯光重新拟合仍保留当前倍率，不能在已有半幅上再次乘0.5。
        await page.evaluate(() => window.DisplayMmd.setLighting({ keyIntensity: 2.2 }));
        await frames();
        const refitted = await page.evaluate(() => window.MmdArTestShadowMapDiagnostic());
        assert.ok(Math.abs(cameraWidth(refitted.maps[0].camera) - cameraWidth(baseCameras[0]) * 0.5) < 1e-6);
        checkGrid(refitted);
        // 调用真实移动入口，移动中已跟随；纯平移及静止不重复获取角色包围范围。
        const beforeMove = refitted;
        assert.equal(await page.evaluate(() => window.DisplayMmd.translateModelByPixels(45, 20)), true);
        await frames(2);
        const moved = await page.evaluate(() => window.MmdArTestShadowMapDiagnostic());
        const delta = moved.follow.position.map((value, index) => value - beforeMove.follow.position[index]);
        assert.ok(delta.some(value => Math.abs(value) > 0.001));
        assert.equal(moved.follow.fitCount, beforeMove.follow.fitCount);
        assert.ok(moved.follow.translationCount > beforeMove.follow.translationCount);
        for (const [index, map] of moved.maps.entries()) {
            for (const component of ['position', 'target']) {
                for (let axis = 0; axis < 3; axis += 1) {
                    assert.ok(Math.abs(map[component][axis] - beforeMove.maps[index][component][axis] - delta[axis]) < 1e-6);
                }
            }
            assert.ok(Math.abs(cameraWidth(map.camera) - cameraWidth(beforeMove.maps[index].camera)) < 1e-6);
        }
        for (let axis = 0; axis < 3; axis += 1) {
            assert.ok(Math.abs(moved.follow.planePosition[axis] - beforeMove.follow.planePosition[axis] - delta[axis]) < 1e-6);
        }
        checkGrid(moved); assert.equal(moved.memory.textures, beforeMove.memory.textures);
        await frames(3);
        assert.equal(await page.evaluate(() => window.MmdArTestShadowMapDiagnostic().follow.fitCount), moved.follow.fitCount);
        // 定位入口同时改变位置与比例：范围只随这次缩放重新拟合，复位恢复原根姿态。
        assert.equal(await page.evaluate(() => window.DisplayMmd.setArPose({ x: 0.6, y: 0.6, scale: 1.4 })), true);
        await frames(2);
        const scaled = await page.evaluate(() => window.MmdArTestShadowMapDiagnostic());
        assert.ok(scaled.follow.fitCount > moved.follow.fitCount);
        assert.ok(scaled.follow.scale[0] > beforeMove.follow.scale[0]);
        assert.ok(cameraWidth(scaled.maps[0].camera) > cameraWidth(moved.maps[0].camera));
        checkGrid(scaled);
        await page.evaluate(() => window.DisplayMmd.resetArPose());
        await frames(2);
        const resetPose = await page.evaluate(() => window.MmdArTestShadowMapDiagnostic());
        for (let axis = 0; axis < 3; axis += 1) {
            assert.ok(Math.abs(resetPose.follow.position[axis] - beforeMove.follow.position[axis]) < 1e-6);
            assert.ok(Math.abs(resetPose.follow.scale[axis] - beforeMove.follow.scale[axis]) < 1e-6);
        }
        assert.ok(Math.abs(cameraWidth(resetPose.maps[0].camera) - cameraWidth(beforeMove.maps[0].camera)) < 1e-6);
        checkGrid(resetPose);
        await page.evaluate(() => window.DisplayMmd.setLighting({ shadowSource: 'key' }));
        await page.waitForFunction(() => document.getElementById('mmdArShadowMapFillStatus').textContent.includes('复用上图'));
        await page.evaluate(() => window.DisplayMmd.setLighting({ keyShadowEnabled: false, shadowSource: 'none' }));
        await page.waitForFunction(() => document.getElementById('mmdArShadowMapKeyStatus').textContent.includes('关闭'));
        // 面板折叠时暂停读回，不改变开关；再开启则恢复更新。
        await page.evaluate(() => document.getElementById('displayMmdLightingToggle').click());
        const beforeHidden = await page.evaluate(() => window.MmdArTestShadowMapDiagnostic().preview.reads);
        await frames(4);
        assert.equal(await page.evaluate(() => window.MmdArTestShadowMapDiagnostic().preview.reads), beforeHidden);
        await page.evaluate(() => {
            window.DisplayMmd.setLighting({ keyShadowEnabled: true, fillEnabled: true, shadowSource: 'fill' });
            const toggle = document.getElementById('mmdArShadowMapPreviewEnabled');
            toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await frames();
        const disabled = await page.evaluate(() => window.MmdArTestShadowMapDiagnostic());
        assert.equal(disabled.preview.allocated, false);
        assert.equal(disabled.memory.textures, stableTextureCount);
        await chooseSize(2048);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady && window.MmdArTestShadowMapDiagnostic?.().size === 2048, { timeout: 90000 });
        assert.equal(await page.$eval('#mmdArShadowMapSize', node => node.value), '2048');
        assert.equal(await page.$eval('#mmdArShadowCameraScale', node => node.value), '0.5');
        assert.equal(await page.evaluate(() => window.MmdArTestShadowMapDiagnostic().cameraScale), 0.5);
        await page.evaluate(() => document.getElementById('displayMmdLightingReset').click());
        await page.waitForFunction(() => window.MmdArTestShadowMapDiagnostic().size === 1024);
        assert.equal(await page.$eval('#mmdArShadowMapPreviewEnabled', node => node.checked), false);
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aasc.mmdArTest.shadowMap.v1'))), { size: 1024, previewEnabled: false, cameraScale: 1 });
        assert.deepEqual(failures, []);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
});
