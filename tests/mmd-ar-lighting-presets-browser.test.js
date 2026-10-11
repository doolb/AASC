'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

test('预设所有操作统一归入可折叠分类，旧亮度选项不再生成', {
    skip: !fs.existsSync(path.join(root, 'index.html'))
}, () => {
    const $ = require('cheerio').load(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
    const group = $('#mmdArLightingPresets');
    assert.ok(group.hasClass('mmd-ar-panel-group'));
    assert.equal(group.parent().attr('id'), 'displayMmdLightingPanel');
    assert.equal(group.find('.mmd-ar-panel-group-toggle').attr('aria-controls'), 'mmdArLightingPresetsBody');
    assert.equal(group.find('.mmd-ar-panel-group-toggle').attr('data-group-title'), '灯光预设');
    assert.equal($('#displayMmdLightingPreset').length, 1);
    assert.equal(group.find('.mmd-ar-panel-group-body [data-preset-action]').length, 6);
    assert.equal(group.find('.mmd-ar-panel-group-body [data-preset-name]').length, 1);
    assert.deepEqual($('#displayMmdLightingPreset option').map((_, node) => $(node).attr('value')).get(), ['custom']);
});

test('真实网页完整灯光预设保存/刷新/文件往返与跨设备限制，保持动作物理定位', {
    skip: !chrome || !fs.existsSync(path.join(root, 'index.html')), timeout: 180000
}, async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-lighting-presets-'));
    const server = http.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const absolute = path.resolve(root, pathname.replace(/^\/mnt\/mmd-ar\//u, '') || 'index.html');
        if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
            response.writeHead(404).end(); return;
        }
        const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css' };
        response.setHeader('Content-Type', types[path.extname(absolute)] || 'application/octet-stream');
        fs.createReadStream(absolute).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: chrome, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844 });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.evaluateOnNewDocument(() => {
            if (!sessionStorage.getItem('preset-test-seeded')) {
                sessionStorage.setItem('preset-test-seeded', '1');
                localStorage.setItem('aasc.display.mmdLighting.v1', JSON.stringify({ ambientIntensity: 1.2, physicsFps: 65 }));
                localStorage.setItem('aasc.mmdArTest.physicsEnabled.v1', 'false');
            }
        });
        const url = `http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-preset-action="save"]')?.disabled === false
            && Object.keys(window.MmdArLightingPresetGroups || {}).length === 10);
        assert.equal(await page.$eval('#displayMmdLightingPreset', select => [...select.options].some(option => ['soft', 'bright', 'default'].includes(option.value))), false);
        const initial = await page.evaluate(() => window.DisplayMmd.getLighting());
        assert.equal(initial.ambientIntensity, 1.2, '旧当前灯光必须保留');
        const settings = await page.evaluate(() => {
            const groups = window.MmdArLightingPresetGroups;
            const desired = {
                lighting: { ...groups.lighting.read(), ambientColor: '#ffcc88', ambientIntensity: .7,
                    keyColor: '#abcdef', keyIntensity: 1.7, keyShadowEnabled: false,
                    keyDirection: { longitude: 70, latitude: 25 }, fillEnabled: true, fillColor: '#123456',
                    fillIntensity: .4, fillDirection: { longitude: -80, latitude: 35 }, shadowSource: 'fill',
                    rimLights: [{ enabled: true, color: '#4488ff', intensity: .5, direction: { longitude: -110, latitude: 40 } },
                        { enabled: true, color: '#cc88ff', intensity: .8, direction: { longitude: 120, latitude: 30 } }],
                    pmxToonEnabled: true, pmxAoEnabled: true, pmxAoColor: '#654321', pmxAoIntensity: .8,
                    pmxAoRadiusPercent: 8, pmxAoResolution: 'full', pmxAoSampleCount: 32, pmxAoBlurPassCount: 3, pmxAoBlurRadii: [2, 4, 5] },
                specular: { enabled: true, color: '#557799', intensity: .75, shininess: 64 },
                keyShadowBias: { bias: -.001, normalBias: .04 }, shadowMap: { size: 2048, cameraScale: 1.4, jointFit: true, previewEnabled: true },
                fillFacing: { start: -.5, end: .6 }, aoConcavity: { angle: 15 }, aoPreview: { enabled: true }, aoEdgeCorrection: { enabled: false },
                screenLighting: { contactEnabled: true, giEnabled: true, contactStrength: .65, contactDistance: .5, contactStepCount: 30,
                    giStrength: 1.2, giRadius: 3, quality: 'high', giBlurPassCount: 3, giBlurRadii: [2, 4, 5], contactBlurPassCount: 2, contactBlurRadii: [1, 5, 2] },
                render: { taaEnabled: true, aaMode: 'fsr2', fsr2Scale: .75, taaHistoryWeight: .8, canvasScale: .5, taaJitterScale: .7, taaJitterSamples: 16 }
            };
            for (const [name, value] of Object.entries(desired)) groups[name].apply(value);
            return Object.fromEntries(Object.entries(groups).map(([name, adapter]) => [name, adapter.read()]));
        });
        await page.click('#displayMmdLightingToggle');
        const category = '#mmdArLightingPresets [data-group-title="灯光预设"]';
        await page.click(category);
        assert.equal(await page.$eval('#mmdArLightingPresetsBody', node => node.hidden), true);
        await page.click(category);
        assert.equal(await page.$eval('#mmdArLightingPresetsBody', node => node.hidden), false);
        await page.$eval('[data-preset-name]', field => { field.value = '完整灯光'; });
        await page.click('[data-preset-action="save"]');
        await page.waitForFunction(() => document.querySelector('[data-preset-status]').textContent.includes('已保存'));
        const read = () => page.evaluate(() => Object.fromEntries(Object.entries(window.MmdArLightingPresetGroups).map(([name, adapter]) => [name, adapter.read()])));
        const id = await page.$eval('#displayMmdLightingPreset', node => node.value);
        assert.ok(id && id !== 'custom');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-preset-action="save"]')?.disabled === false
            && document.querySelector('#mmdArLightingPresets')?.dataset.initialized === 'true');
        assert.deepEqual(await read(), settings, '刷新后所有分组恢复');
        await page.click('#displayMmdLightingToggle');
        await page.$eval('#displayMmdAmbientIntensity', field => { field.value = 2; field.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.match(await page.$eval('#displayMmdLightingPreset', node => node.selectedOptions[0].textContent), /已修改/u);
        await page.select('#displayMmdLightingPreset', id);
        assert.deepEqual(await read(), settings, '选择恢复全部参数');
        assert.equal((await page.evaluate(() => window.DisplayMmd.getLighting())).physicsFps, initial.physicsFps);
        await page.waitForFunction(() => window.DisplayMmd.getState().modelReady, { timeout: 60000 });
        const unchanged = await page.evaluate(() => ({ state: window.DisplayMmd.getState(),
            model: window.DisplayMmd.getArCameraState().modelPosition,
            target: document.getElementById('displayArTargetSelect').value,
            rotation: window.DisplayMmd.getLighting().rotationPhysicsLimit }));

        const cdp = await page.createCDPSession();
        await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: folder });
        await page.click('[data-preset-action="export"]');
        const singleFile = path.join(folder, 'mmd-ar-lighting-preset.json');
        for (let retry = 0; retry < 30 && !fs.existsSync(singleFile); retry += 1) await new Promise(resolve => setTimeout(resolve, 100));
        assert.ok(fs.existsSync(singleFile), '实际下载文件');
        const single = JSON.parse(fs.readFileSync(singleFile, 'utf8'));
        assert.deepEqual(single.presets[0].settings, settings);
        assert.equal(single.presets[0].settings.lighting.physicsFps, undefined);

        const badFile = path.join(folder, 'bad.json');
        fs.writeFileSync(badFile, JSON.stringify({ ...single, presets: [single.presets[0], { name: '坏记录', settings: { render: { canvasScale: {} } } }] }));
        const fileInput = await page.$('#mmdArLightingPresets input[type="file"]');
        await fileInput.uploadFile(badFile);
        await page.waitForFunction(() => document.querySelector('[data-preset-status]').dataset.error === 'true');
        assert.deepEqual(await read(), settings);
        assert.equal(await page.$eval('#displayMmdLightingPreset', node => node.options.length), 2);
        await fileInput.uploadFile(singleFile);
        await page.waitForFunction(() => document.querySelector('[data-preset-status]').textContent.includes('已导入1'));
        assert.deepEqual(await read(), settings, '导入不能自动应用或改变场景');
        const importedId = await page.$eval('#displayMmdLightingPreset', node => node.options[2].value);
        assert.match(await page.$eval('#displayMmdLightingPreset', node => node.options[2].textContent), /导入1/u);
        await page.click('#displayMmdLightingReset');
        await page.select('#displayMmdLightingPreset', importedId);
        assert.deepEqual(await read(), settings, '文件往返后全部分组恢复');
        // 原恢复默认会复位物理参数，选择灯光预设必须保留复位后的值。
        assert.equal((await page.evaluate(() => window.DisplayMmd.getLighting())).physicsFps, 90);
        const after = await page.evaluate(() => ({ state: window.DisplayMmd.getState(),
            model: window.DisplayMmd.getArCameraState().modelPosition,
            target: document.getElementById('displayArTargetSelect').value,
            rotation: window.DisplayMmd.getLighting().rotationPhysicsLimit }));
        assert.deepEqual(after, unchanged);

        // 跨设备应用可以降档，但不能把预设记录中的请求配置写坏。
        await page.evaluate(() => {
            window.MmdArTestShadowMapLimit = 1024;
            window.MmdArScreenLightingSupported = false;
            window.MmdArRenderInfo = { taaSupported: false };
        });
        await page.select('#displayMmdLightingPreset', importedId);
        assert.equal((await read()).shadowMap.size, 1024);
        assert.equal(await page.$eval('[data-render-setting="aaMode"]', node => node.disabled), true);
        assert.equal(await page.$eval('[data-screen-lighting="giStrength"]', node => node.disabled), true);
        await page.click('[data-preset-action="exportAll"]');
        const allFile = path.join(folder, 'mmd-ar-lighting-presets.json');
        for (let retry = 0; retry < 30 && !fs.existsSync(allFile); retry += 1) await new Promise(resolve => setTimeout(resolve, 100));
        const all = JSON.parse(fs.readFileSync(allFile, 'utf8'));
        assert.equal(all.presets.length, 2);
        assert.equal(all.presets[1].settings.shadowMap.size, 2048);
        await page.$eval('[data-preset-name]', field => { field.value = '覆盖后的灯光'; });
        await page.click('[data-preset-action="overwrite"]');
        await page.waitForFunction(() => document.querySelector('[data-preset-status]').textContent.includes('已覆盖'));
        await page.click('[data-preset-action="delete"]');
        await page.waitForFunction(() => document.querySelector('[data-preset-status]').textContent.includes('已删除'));
        assert.equal((await read()).shadowMap.size, 1024);
        await page.screenshot({ path: '/tmp/aasc-lighting-presets.png' });
        const layout = await page.$eval('#mmdArLightingPresets', node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
        assert.ok(layout.scroll <= layout.width + 1, '窄屏预设区域不能横向溢出');
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(folder, { recursive: true, force: true });
    }
});
