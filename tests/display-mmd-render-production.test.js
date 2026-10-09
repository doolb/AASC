'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const project = path.resolve(__dirname, '..');
const root = path.join(project, 'src/apps/web-mediacenter/ui/public');
const models = path.join(project, '3rd/mmd-ar-test/web-dist/mmd');
const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(), '/usr/bin/chromium']
    .find(file => file && fs.existsSync(file));

test('正式渲染参数默认关闭、倍率硬件上限与独立存储', async () => {
    const { defaults, storageKey, calculateCanvasSize, normalizeRenderSettings } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-render-settings.mjs');
    const { normalizeScreenLightingSettings } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-screen-lighting-panel.mjs');
    assert.equal(storageKey, 'aasc.display.mmd.render.v1');
    assert.equal(defaults.taaEnabled, false);
    assert.equal(defaults.aaMode, 'taa');
    assert.equal(defaults.fsr2Scale, .67);
    assert.equal(normalizeRenderSettings({ aaMode: 'fsr2', fsr2Scale: .1 }).fsr2Scale, .5);
    assert.equal(normalizeRenderSettings({ aaMode: 'bad', fsr2Scale: 2 }).aaMode, 'taa');
    assert.equal(normalizeRenderSettings({ fsr2Scale: 2 }).fsr2Scale, 1);
    assert.equal(normalizeScreenLightingSettings({}).contactEnabled, false);
    assert.equal(normalizeScreenLightingSettings({}).giEnabled, false);
    assert.deepEqual(normalizeRenderSettings({ canvasScale: 8, taaJitterScale: -1, taaJitterSamples: 6 }),
        { taaEnabled: false, aaMode: 'taa', fsr2Scale: .67, canvasScale: 2, taaHistoryWeight: .9, taaJitterScale: 0, taaJitterSamples: 8 });
    const limited = calculateCanvasSize(1000, 500, 2, 2, 1024);
    assert.deepEqual([limited.width, limited.height, limited.limited], [1024, 512, true]);
});

test('正式面板保存/复位与真实PMX渲染组合、倍率保留视角、TAA历史释放', {
    skip: !chrome || !fs.existsSync(path.join(models, 'miya/miya.pmx')), timeout: 120000
}, async () => {
    // 只移除服务器/语音业务脚本，保留实际正式HTML、CSS、面板和ESM资源用于集成验收。
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'display.html'), 'utf8'));
    $('script').each((_index, node) => {
        const item = $(node);
        if (item.attr('type') === 'importmap' || /(?:display-mmd-panel-groups\.js|mmd-(?:render-settings|screen-lighting-panel)\.mjs)$/u.test(item.attr('src') || '')) return;
        item.remove();
    });
    const html = $.html();
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
        if (!relative) { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
        const isModel = relative.startsWith('models/mmd/');
        const directory = isModel ? models : root;
        const file = path.resolve(directory, isModel ? relative.slice(11) : relative);
        if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
        response.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    const cache = path.join(os.homedir(), '.cache/aasc-render-production');
    fs.mkdirSync(cache, { recursive: true });
    const profile = fs.mkdtempSync(path.join(cache, 'browser-'));
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile,
            env: { ...process.env, TMPDIR: cache }, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error' && /shader|webgl|compile|linkprogram/iu.test(message.text())) errors.push(message.text()); });
        await page.setViewport({ width: 320, height: 480 });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => window.DisplayMmdRenderSettings && window.DisplayMmdScreenLighting);
        const controls = await page.evaluate(() => {
            const set = (attribute, name, value) => {
                const input = document.querySelector(`[${attribute}="${name}"]`);
                if (input.type === 'checkbox') input.checked = value; else input.value = String(value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            };
            set('data-render-setting', 'canvasScale', .5);
            set('data-render-setting', 'taaJitterSamples', 16);
            set('data-render-setting', 'aaMode', 'fsr2');
            set('data-render-setting', 'fsr2Scale', .5);
            set('data-screen-lighting', 'contactEnabled', true);
            set('data-screen-lighting', 'giEnabled', true);
            const toggle = document.querySelector('#mmdArTemporalAA [data-render-group]');
            toggle.click();
            return { render: window.DisplayMmdRenderSettings, lighting: window.DisplayMmdScreenLighting,
                open: !document.getElementById('mmdArTemporalAABody').hidden,
                duplicateIds: new Set([...document.querySelectorAll('[id]')].map(node => node.id)).size !== document.querySelectorAll('[id]').length,
                testStorage: localStorage.getItem('aasc.mmdArTest.render.v1'), voice: !!document.getElementById('displayVoiceAction') };
        });
        assert.equal(controls.render.canvasScale, .5);
        assert.equal(controls.render.taaJitterSamples, 16);
        assert.equal(controls.render.aaMode, 'fsr2');
        assert.equal(controls.render.fsr2Scale, .5);
        assert.equal(controls.lighting.contactEnabled, true);
        assert.equal(controls.open, true);
        assert.equal(controls.duplicateIds, false);
        assert.equal(controls.testStorage, null);
        assert.equal(controls.voice, true);
        await page.reload();
        await page.waitForFunction(() => window.DisplayMmdRenderSettings?.canvasScale === .5
            && window.DisplayMmdRenderSettings?.aaMode === 'fsr2' && window.DisplayMmdRenderSettings?.fsr2Scale === .5);
        const runtime = await page.evaluate(async () => {
            const { createDisplayPmxRuntime } = await import('/js/display-pmx-runtime.js');
            const canvas = document.getElementById('displayMmdCanvas');
            const instance = createDisplayPmxRuntime({ canvas });
            window.MmdArAframeMode = true;
            instance.setPhysicsEnabled(false); instance.setMotionPlaybackEnabled(false);
            instance.resize(160, 240, 1);
            await instance.load({ modelType: 'pmx', modelUrl: '/models/mmd/miya/miya.pmx',
                motionUrl: '/models/mmd/motions/miya-default.vmd', motionResourceId: 'miya-default-motion', playMode: 'loop' });
            instance.setCameraViewRotation(.3, .1);
            await new Promise(resolve => setTimeout(resolve, 300));
            instance.setVisible(false);
            const before = instance.getArCameraState();
            window.DisplayMmdRenderSettings = { ...window.DisplayMmdRenderSettings, canvasScale: 1 };
            instance.resize(160, 240, 1);
            const after = instance.getArCameraState(), size = [canvas.width, canvas.height];
            instance.dispose();
            return { before, after, size };
        });
        assert.deepEqual(runtime.after.cameraPosition, runtime.before.cameraPosition);
        assert.deepEqual(runtime.after.cameraQuaternion, runtime.before.cameraQuaternion);
        assert.deepEqual(runtime.size, [160, 240]);
        const gpu = await page.evaluate(async () => {
            const THREE = await import('three');
            const { createPmxAmbientOcclusion } = await import('/js/display-pmx-ao.mjs');
            const renderer = new THREE.WebGLRenderer({ alpha: true }); renderer.setSize(65, 97);
            const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 65 / 97, .1, 20);
            camera.position.z = 4; camera.updateMatrixWorld();
            const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(1, 2, 3); scene.add(light, light.target);
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshStandardMaterial({ color: 0x4477bb })); scene.add(mesh);
            const ao = createPmxAmbientOcclusion({ THREE, renderer, scene, camera, keyLight: light }); ao.resize(65, 97);
            window.DisplayMmdRenderSettings = { taaEnabled: true, taaHistoryWeight: .9, taaJitterScale: 1, taaJitterSamples: 16 };
            window.DisplayMmdScreenLighting = { contactEnabled: true, giEnabled: true, quality: 'low',
                contactBlurPassCount: 3, contactBlurRadii: [1, 3, 5], giBlurPassCount: 3, giBlurRadii: [1, 3, 5] };
            for (let i = 0; i < 4; i += 1) ao.render();
            const gl = renderer.getContext(), pixels = new Uint8Array(65 * 97 * 4);
            gl.readPixels(0, 0, 65, 97, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            const accumulated = ao.getTemporalState();
            window.DisplayMmdRenderSettings = { ...window.DisplayMmdRenderSettings, aaMode: 'fsr2', fsr2Scale: .5 };
            ao.render(); const fsr2First = ao.getTemporalState();
            ao.render(); const fsr2Accumulated = ao.getTemporalState();
            // 观察实际场景目标，确保空间合成的深度/颜色真正降采样，不能只检查TAA内部目标。
            const originalRender = renderer.render, sceneSizes = [];
            renderer.render = function(nextScene, nextCamera) {
                if (nextScene === scene) sceneSizes.push([this.getRenderTarget()?.width, this.getRenderTarget()?.height]);
                return originalRender.call(this, nextScene, nextCamera);
            };
            ao.render();
            ao.render({ bypassTemporal: true }); const bypassed = ao.getTemporalState();
            ao.render(); const resumed = ao.getTemporalState();
            window.DisplayMmdRenderSettings = { ...window.DisplayMmdRenderSettings, aaMode: 'taa' };
            ao.render(); const switched = ao.getTemporalState();
            renderer.render = originalRender;
            ao.invalidateTemporal(); const reset = ao.getTemporalState();
            window.DisplayMmdRenderSettings = { taaEnabled: false }; ao.render(); const closed = ao.getTemporalState();
            ao.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); renderer.dispose();
            return { accumulated, fsr2First, fsr2Accumulated, sceneSizes, bypassed, resumed, switched, reset, closed,
                opaque: pixels.filter((value, index) => index % 4 === 3 && value > 0).length, error: gl.getError() };
        });
        assert.equal(gpu.accumulated.lastHistoryUsed, true);
        assert.equal(gpu.fsr2First.lastHistoryUsed, false);
        assert.equal(gpu.fsr2Accumulated.lastHistoryUsed, true);
        assert.deepEqual([gpu.fsr2Accumulated.inputWidth, gpu.fsr2Accumulated.inputHeight,
            gpu.fsr2Accumulated.width, gpu.fsr2Accumulated.height], [32, 48, 65, 97]);
        assert.deepEqual(gpu.sceneSizes, [[32, 48], [65, 97], [32, 48], [65, 97]]);
        assert.equal(gpu.bypassed.targetCount, 0);
        assert.equal(gpu.resumed.lastHistoryUsed, false);
        assert.equal(gpu.switched.lastHistoryUsed, false);
        assert.deepEqual([gpu.switched.inputWidth, gpu.switched.inputHeight], [65, 97]);
        assert.equal(gpu.reset.historyValid, false);
        assert.equal(gpu.closed.targetCount, 0);
        assert.ok(gpu.opaque > 100);
        assert.equal(gpu.error, 0);
        const reset = await page.evaluate(() => {
            document.getElementById('displayMmdLightingReset').click();
            return { render: window.DisplayMmdRenderSettings, screen: window.DisplayMmdScreenLighting };
        });
        assert.equal(reset.render.canvasScale, 1);
        assert.equal(reset.render.taaEnabled, false);
        assert.equal(reset.render.aaMode, 'taa');
        assert.equal(reset.render.fsr2Scale, .67);
        assert.equal(reset.screen.contactEnabled, false);
        assert.equal(reset.screen.giEnabled, false);
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(profile, { recursive: true, force: true });
    }
});
