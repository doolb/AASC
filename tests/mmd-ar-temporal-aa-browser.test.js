'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer');
const project = path.resolve(__dirname, '..'), root = path.join(project, '3rd/mmd-ar-test/web-dist');
const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe']
    .find(file => file && fs.existsSync(file));

async function withBrowser(action) {
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
        const source = relative.startsWith('__source/');
        const directory = source ? project : root;
        const file = path.resolve(directory, source ? relative.slice(9) : (relative || 'index.html'));
        if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
        response.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: chrome, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error' && /shader|webgl|compile|linkprogram/iu.test(message.text())) errors.push(message.text()); });
        const origin = `http://127.0.0.1:${server.address().port}`;
        await action(page, origin);
        assert.deepEqual(errors, [], '浏览器及真实Shader不得报错');
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

test('真实GPU TAA边缘收敛、颜色/透明alpha和揭露历史拒绝', { skip: !chrome, timeout: 60000 }, async context => {
    await withBrowser(async (page, origin) => {
        await page.goto(`${origin}/__source/package.json`);
        const result = await page.evaluate(async () => {
            const THREE = await import('/__source/node_modules/three/build/three.module.js');
            const { createTemporalAA } = await import('/__source/3rd/mmd-ar-test/web-temporal-aa.mjs');
            const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false }); renderer.setSize(64, 64);
            renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
            const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 20);
            camera.position.z = 4; camera.updateMatrixWorld();
            const material = new THREE.MeshBasicMaterial({ color: 0x4488cc });
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), material); mesh.rotation.z = .31; scene.add(mesh);
            const target = new THREE.WebGLRenderTarget(64, 64, { depthTexture: new THREE.DepthTexture(64, 64, THREE.UnsignedIntType) });
            const config = { taaEnabled: true, taaHistoryWeight: .9 };
            const taa = createTemporalAA({ THREE, renderer, camera, getSettings: () => config });
            // 场景颜色直接拷贝到TAA输入，保持线性预乘，不引入额外色彩变换。
            const copyMaterial = new THREE.ShaderMaterial({ toneMapped: false, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
                uniforms: { tColor: { value: target.texture } }, vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
                fragmentShader: 'uniform sampler2D tColor;varying vec2 vUv;void main(){gl_FragColor=texture2D(tColor,vUv);}' });
            const copyScene = new THREE.Scene(); copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial));
            const copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
            const draw = () => {
                const output = renderer.getRenderTarget(); renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera);
                renderer.setRenderTarget(output); renderer.clear(); renderer.render(copyScene, copyCamera);
            };
            const gl = renderer.getContext();
            const pixels = () => { const values = new Uint8Array(64 * 64 * 4); gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, values); return values; };
            renderer.render(scene, camera); const baseline = pixels();
            for (let frame = 0; frame < 16; frame += 1) taa.render(draw, () => target.depthTexture);
            const accumulated = pixels();
            const partial = values => { let count = 0; for (let i = 3; i < values.length; i += 4) if (values[i] > 1 && values[i] < 254) count += 1; return count; };
            const center = values => [...values.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4)];
            const state = taa.getState(), colored = center(accumulated), original = center(baseline);
            material.color.set(0x0000ff); taa.render(draw, () => target.depthTexture); const changed = center(pixels());
            scene.remove(mesh); taa.render(draw, () => target.depthTexture); const cleared = center(pixels());
            scene.add(mesh); material.transparent = true; material.opacity = .5; material.needsUpdate = true;
            taa.invalidate(); taa.render(draw, () => target.depthTexture); const transparent = center(pixels());
            const { createPmxAmbientOcclusion } = await import('/js/display-pmx-ao.mjs');
            const ao = createPmxAmbientOcclusion({ THREE, renderer, camera, scene }); ao.resize(64, 64); ao.setIntensity(0);
            window.MmdArRenderSettings = { taaEnabled: false, taaHistoryWeight: .9 };
            ao.render(); const transparentAoOff = center(pixels());
            window.MmdArRenderSettings = { taaEnabled: true, taaHistoryWeight: .9 };
            for (let i = 0; i < 8; i += 1) ao.render(); const transparentAoOn = center(pixels());
            ao.dispose();
            // 用真实GPU强制走RGBA8颜色回退，验证无浮点目标设备的呈现路径。
            const hasExtension = renderer.extensions.has.bind(renderer.extensions);
            renderer.extensions.has = name => name === 'EXT_color_buffer_float' ? false : hasExtension(name);
            const byteTaa = createTemporalAA({ THREE, renderer, camera, getSettings: () => config });
            byteTaa.render(draw, () => target.depthTexture); const byteTransparent = center(pixels()); byteTaa.dispose();
            renderer.extensions.has = hasExtension;
            camera.position.x = 20; camera.updateMatrixWorld(); taa.render(draw, () => target.depthTexture); const cut = taa.getState();
            const error = gl.getError(); taa.dispose(); target.dispose(); renderer.dispose();
            return { original, colored, changed, cleared, transparent, byteTransparent, transparentAoOff, transparentAoOn, basePartial: partial(baseline), taaPartial: partial(accumulated), state, cut, error };
        });
        context.diagnostic(JSON.stringify(result));
        assert.ok(result.taaPartial > result.basePartial + 10, 'TAA必须实际增加轮廓覆盖的中间alpha');
        for (let index = 0; index < 4; index += 1) assert.ok(Math.abs(result.original[index] - result.colored[index]) <= 2, '静态内部颜色保持');
        assert.ok(result.changed[0] < 3 && result.changed[1] < 3 && result.changed[2] > 150, '动态颜色不能残留旧帧');
        assert.deepEqual(result.cleared, [0, 0, 0, 0], '揭露背景必须拒绝旧遮挡');
        assert.ok(result.transparent[3] >= 126 && result.transparent[3] <= 129);
        assert.ok(result.transparent[2] > 100 && result.transparent[2] <= result.transparent[3] + 1, '预乘alpha不能重复乘而变黑');
        for (let index = 0; index < 4; index += 1) assert.ok(Math.abs(result.transparentAoOff[index] - result.transparentAoOn[index]) <= 2, '真实AO合成链在TAA开/关时半透明内部颜色一致');
        for (let index = 0; index < 4; index += 1) assert.ok(Math.abs(result.byteTransparent[index] - result.transparent[index]) <= 2, 'RGBA8回退的透明颜色保持');
        assert.equal(result.state.lastHistoryUsed, true); assert.equal(result.cut.lastHistoryUsed, false); assert.equal(result.error, 0);
    });
});

test('真实模型倍率/DPR/保存复位、TAA组合和后台相机保留', {
    skip: !chrome || !fs.existsSync(path.join(root, 'mmd/miya/miya.pmx')), timeout: 180000
}, async context => {
    await withBrowser(async (page, origin) => {
        await page.setViewport({ width: 320, height: 400 });
        await page.goto(`${origin}/?safePhysics=1`, { waitUntil: 'domcontentloaded' });
        const ready = () => page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 45000 });
        await ready();
        const update = async (name, value) => page.$eval(`[data-render-setting="${name}"]`, (node, setting) => {
            if (node.type === 'checkbox') node.checked = setting; else node.value = String(setting);
            node.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        const size = async (width, height) => page.waitForFunction((w, h) => {
            const c = window.DisplayMmd.getEditorBridge().context.renderer.domElement; return c.width === w && c.height === h;
        }, {}, width, height);
        for (const dpr of [1, 2]) {
            await page.setViewport({ width: 320, height: 400, deviceScaleFactor: dpr });
            for (const scale of [.25, .5, 1, 1.5, 2]) { await update('canvasScale', scale); await size(320 * dpr * scale, 400 * dpr * scale); }
        }
        await update('canvasScale', .5); await update('taaEnabled', true);
        await size(320, 400);
        const picture = await page.evaluate(async () => {
            const bridge = window.DisplayMmd.getEditorBridge(), c = bridge.context;
            c.helper.enable('physics', false); c.helper.enable('animation', false); bridge.rest();
            const state = () => ({ root: c.currentPivot.position.toArray(), rotation: c.currentPivot.quaternion.toArray(), scale: c.currentPivot.scale.toArray(),
                camera: c.camera.position.toArray(), cameraRotation: c.camera.quaternion.toArray(), zoom: c.camera.zoom, projection: c.camera.projectionMatrix.toArray() });
            const before = state(); const coverage = [];
            for (const [contactEnabled, giEnabled] of [[false,false],[true,false],[false,true],[true,true]]) {
                window.MmdArScreenLighting = { ...window.MmdArScreenLighting, contactEnabled, giEnabled };
                for (let i = 0; i < 3; i += 1) c.ambientOcclusion.render();
                const gl = c.renderer.getContext(), data = new Uint8Array(320 * 400 * 4);
                gl.readPixels(0, 0, 320, 400, gl.RGBA, gl.UNSIGNED_BYTE, data);
                coverage.push({ pixels: data.filter((value, index) => index % 4 === 3 && value > 127).length,
                    error: gl.getError(), temporal: c.ambientOcclusion.getTemporalState() });
            }
            window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow'));
            const reset = c.ambientOcclusion.getTemporalState();
            c.ambientOcclusion.render();
            return { before, after: state(), reset, coverage };
        });
        assert.deepEqual(picture.after, picture.before, '后台与绘制只清历史，角色和相机不复位');
        assert.equal(picture.reset.historyValid, false);
        for (const sample of picture.coverage) { assert.ok(sample.pixels > 1000); assert.equal(sample.error, 0); assert.equal(sample.temporal.lastHistoryUsed, true); }
        const motion = await page.evaluate(async () => {
            const bridge = window.DisplayMmd.getEditorBridge(), c = bridge.context;
            const positions = c.mesh.skeleton.bones.map(bone => bone.quaternion.toArray());
            c.helper.enable('animation', true); bridge.seek(.4);
            const seekReset = c.ambientOcclusion.getTemporalState().historyValid;
            for (let i = 0; i < 8; i += 1) await new Promise(resolve => requestAnimationFrame(resolve));
            const changed = c.mesh.skeleton.bones.some((bone, index) => bone.quaternion.toArray().some((value, component) => Math.abs(value - positions[index][component]) > 1e-5));
            const frame = c.ambientOcclusion.getTemporalState();
            c.helper.enable('animation', false); bridge.rest();
            const capture = await bridge.capture(160, 200, true);
            const bitmap = await createImageBitmap(capture), imageSize = [bitmap.width, bitmap.height]; bitmap.close();
            return { seekReset, changed, frame, imageSize, bytes: capture.size, width: c.renderer.domElement.width, height: c.renderer.domElement.height };
        });
        assert.equal(motion.seekReset, false); assert.equal(motion.changed, true, '真实动画骨骼应实际运动');
        assert.equal(motion.frame.lastHistoryUsed, true); assert.deepEqual(motion.imageSize, [160, 200]);
        assert.ok(motion.bytes > 1000); assert.deepEqual([motion.width, motion.height], [320, 400]);
        const timings = [];
        for (const scale of [.5, 1, 2]) {
            await update('canvasScale', scale); await size(640 * scale, 800 * scale);
            for (const enabled of [false, true]) {
                await update('taaEnabled', enabled);
                timings.push(await page.evaluate(() => {
                    const c = window.DisplayMmd.getEditorBridge().context, gl = c.renderer.getContext();
                    window.MmdArScreenLighting = { ...window.MmdArScreenLighting, contactEnabled: true, giEnabled: false };
                    const samples = [], pixel = new Uint8Array(4);
                    for (let i = 0; i < 5; i += 1) {
                        gl.finish(); const begin = performance.now(); c.ambientOcclusion.render();
                        gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                        gl.finish(); if (i > 1) samples.push(performance.now() - begin);
                    }
                    samples.sort((a, b) => a - b);
                    if (gl.getError()) throw new Error('GPU计时期间渲染失败');
                    const state = c.ambientOcclusion.getTemporalState();
                    return { scale: window.MmdArRenderSettings.canvasScale, taa: window.MmdArRenderSettings.taaEnabled,
                        width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, medianMs: Number(samples[1].toFixed(2)),
                        targets: state.targetCount, extraBytes: state.targetCount ? state.width * state.height * (c.renderer.extensions.has('EXT_color_buffer_float') ? 32 : 20) : 0 };
                }));
            }
        }
        context.diagnostic(`完整GPU完成耗时（软件GPU）：${JSON.stringify(timings)}`);
        await update('canvasScale', .5); await update('taaEnabled', true); await size(320, 400);
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await size(320, 400);
        assert.deepEqual(await page.evaluate(() => window.MmdArRenderSettings), { taaEnabled: true, taaHistoryWeight: .9, canvasScale: .5 });
        await page.$eval('#displayMmdLightingReset', node => node.click()); await size(640, 800);
        assert.equal(await page.evaluate(() => window.MmdArRenderSettings.taaEnabled), false);
        await page.click('#displayMmdLightingToggle');
        const layout = await page.$eval('[data-render-setting="canvasScale"]', node => {
            const bounds = node.getBoundingClientRect(), panel = document.getElementById('displayMmdLightingPanel').getBoundingClientRect();
            return { left: bounds.left, right: bounds.right, panelLeft: panel.left, panelRight: panel.right };
        });
        assert.ok(layout.left >= layout.panelLeft && layout.right <= layout.panelRight, '窄屏倍率滑块不能超出面板');
        if (process.env.MMD_AR_TAA_SCREENSHOT) await page.screenshot({ path: process.env.MMD_AR_TAA_SCREENSHOT.replace('.png', '-top.png') });
        await page.click('#mmdArTemporalAA [data-group-title="抗锯齿"]');
        assert.equal(await page.$eval('#mmdArTemporalAABody', node => node.hidden), false);
        if (process.env.MMD_AR_TAA_SCREENSHOT) await page.screenshot({ path: process.env.MMD_AR_TAA_SCREENSHOT });
        context.diagnostic(`四种屏幕光照组合有效像素：${picture.coverage.map(row => row.pixels).join(',')}`);
        await update('taaEnabled', true); await update('canvasScale', .5);
        await page.goto(`${origin}/?safePhysics=1&character=xishi`, { waitUntil: 'domcontentloaded' }); await ready();
        const staticPicture = await page.evaluate(() => {
            const c = window.DisplayMmd.getEditorBridge().context;
            for (let i = 0; i < 3; i += 1) c.ambientOcclusion.render();
            const gl = c.renderer.getContext(), data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
            return { type: window.DisplayMmd.getModelProfile().modelType,
                pixels: data.filter((value, index) => index % 4 === 3 && value > 127).length, state: c.ambientOcclusion.getTemporalState(), error: gl.getError() };
        });
        assert.equal(staticPicture.type, 'glb'); assert.ok(staticPicture.pixels > 1000);
        assert.equal(staticPicture.state.lastHistoryUsed, true); assert.equal(staticPicture.error, 0);
        context.diagnostic(`静态GLB有效像素：${staticPicture.pixels}`);
    });
});
