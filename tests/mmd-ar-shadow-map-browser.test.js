'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = '/usr/bin/chromium';

test('真实PMX四档阴影尺寸、整图覆盖/双光模式、保存复位及GPU资源回收', {
    skip: !fs.existsSync(CHROME) || !fs.existsSync(path.join(ROOT, 'index.html')), timeout: 360000
}, async () => {
    const failures = [];
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).slice(1) || 'index.html';
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm' };
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
            return page.evaluate(() => window.MmdArTestShadowMapDiagnostic());
        };
        const baseline = await chooseSize(512);
        let stableTextureCount = baseline.memory.textures;
        const sizes = [];
        for (const size of [1024, 2048, 4096, 512, 2048, 512]) {
            const state = await chooseSize(size); sizes.push(state.size);
            // 原AO关闭后的资源可能延迟释放，数量可下降；尺寸切换不得积累贴图。
            assert.ok(state.memory.textures <= baseline.memory.textures, `尺寸${size}不应积累GPU贴图`);
            stableTextureCount = state.memory.textures;
        }
        assert.deepEqual(sizes, [1024, 2048, 4096, 512, 2048, 512]);
        await page.evaluate(() => {
            const toggle = document.getElementById('mmdArShadowMapPreviewEnabled');
            toggle.checked = true; toggle.dispatchEvent(new Event('change', { bubbles: true }));
            document.getElementById('mmdArShadowMapPreviewRows').scrollIntoView({ block: 'center' });
        });
        await page.waitForFunction(() => window.MmdArTestShadowMapDiagnostic().preview.reads >= 2, { timeout: 30000 });
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
        await page.evaluate(() => document.getElementById('displayMmdLightingReset').click());
        await page.waitForFunction(() => window.MmdArTestShadowMapDiagnostic().size === 1024);
        assert.equal(await page.$eval('#mmdArShadowMapPreviewEnabled', node => node.checked), false);
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aasc.mmdArTest.shadowMap.v1'))), { size: 1024, previewEnabled: false });
        assert.deepEqual(failures, []);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
});
