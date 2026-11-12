'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const dir = path.resolve('src/apps/web-mediacenter/ui/public');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(), '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

test('壁纸和前台切换、独立开关、音量与时间安全区', { skip: !executablePath, timeout: 30000 }, async t => {
    let browser;
    try { browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
    catch (error) { t.skip(`Chromium 无法启动：${error.message.split('\n')[0]}`); return; }
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setViewport({ width: 480, height: 800 });
    const html = fs.readFileSync(path.join(dir, 'display.html'), 'utf8');
    const panel = html.slice(html.indexOf('    <div id="wallpaperInteractionShield"'), html.indexOf('    </aside>') + '    </aside>'.length);
    const css = fs.readFileSync(path.join(dir, 'css/display-wallpaper-controls.css'), 'utf8');
    await page.setContent(`<style>${css} #timeDisplay { position: fixed; top: 0; right: 0; } #cover { position: fixed; inset: 0; z-index: 999999; }</style><div id="cover"></div><div id="timeDisplay">12:00</div>${panel}<div id="connectionStatus">已连接</div><div id="voiceStatus">监听中</div><div id="displayStageLayers"><div id="displayInteractionLayer"><button id="normalControl">按钮</button><div id="displayVoiceAsrResult" hidden>识别文字</div></div><div id="displayMmdFps">60 FPS</div></div>`);
    await page.evaluate(() => {
        const preferences = {};
        Object.defineProperty(window, 'localStorage', { value: { getItem: key => preferences[key] ?? null, setItem: (key, value) => { preferences[key] = value; } } });
        window.wallpaper = false; window.actualVolume = 36; window.previewCount = 0;
        window.hologram = {}; window.sensorEnabled = false;
        window.DisplayMmd = { setHolographicTilt: value => { window.hologram = value; } };
        window.NativeDisplay = { isWallpaperActive: () => window.wallpaper, getWallpaperTopInset: () => 30,
            openWallpaperPreview: () => { window.previewCount++; }, getWallpaperMediaVolume: () => window.actualVolume, setWallpaperMediaVolume: value => { window.actualVolume = value; },
            setHolographicSensorEnabled: value => { window.sensorEnabled = value; return true; } };
    });
    await page.addScriptTag({ path: path.join(dir, 'js/display-wallpaper-controls.js') });
    assert.equal(await page.$eval('#wallpaperControls', node => node.hidden), false);
    assert.equal(await page.$eval('#wallpaperHologramModel', node => node.checked), false);
    assert.equal(await page.$eval('#wallpaperHologramCamera', node => node.checked), false);
    await page.$eval('#wallpaperHologramModel', node => { node.checked = true; node.dispatchEvent(new Event('change')); });
    assert.equal(await page.evaluate(() => window.sensorEnabled), true);
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 0, gamma: 0 } }));
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 10, gamma: 20 } }));
    });
    let tilt = await page.evaluate(() => window.hologram);
    assert.ok(Math.abs(tilt.modelYaw) > 0 && tilt.cameraX === 0);
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = true; node.dispatchEvent(new Event('change')); });
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 0, gamma: 0 } }));
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 80, gamma: 170 } }));
    });
    tilt = await page.evaluate(() => window.hologram);
    assert.equal(Math.abs(tilt.modelYaw), 0.14); assert.equal(Math.abs(tilt.cameraX), 0.14);
    assert.equal(Math.abs(tilt.cameraY), 0.14);
    await page.$eval('#wallpaperHologramModel', node => { node.checked = false; node.dispatchEvent(new Event('change')); });
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 0, gamma: 0 } }));
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 10, gamma: 20 } }));
    });
    tilt = await page.evaluate(() => window.hologram);
    assert.equal(tilt.modelYaw, 0); assert.ok(Math.abs(tilt.cameraX) > 0);
    // 横屏时设备倾斜要换算到屏幕横纵轴，再发给镜头平移。
    await page.evaluate(() => {
        Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { angle: 90 } });
        window.dispatchEvent(new Event('aasc-hologram-visibility'));
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 0, gamma: 0 } }));
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 10, gamma: 0 } }));
    });
    tilt = await page.evaluate(() => window.hologram);
    assert.ok(Math.abs(tilt.cameraX) > 0.01); assert.ok(Math.abs(tilt.cameraY) < 1e-8);
    await page.evaluate(() => { delete window.screen.orientation; });
    await page.evaluate(() => window.dispatchEvent(new Event('aasc-hologram-visibility')));
    assert.deepEqual(await page.evaluate(() => window.hologram), {});
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = false; node.dispatchEvent(new Event('change')); });
    assert.equal(await page.evaluate(() => window.sensorEnabled), false);
    assert.deepEqual(await page.evaluate(() => window.hologram), {});
    await page.evaluate(() => { window.NativeDisplay.setHolographicSensorEnabled = () => false; });
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = true; node.dispatchEvent(new Event('change')); });
    assert.match(await page.$eval('#wallpaperHologramStatus', node => node.textContent), /没有可用的姿态传感器/);
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = false; node.dispatchEvent(new Event('change')); });
    await page.click('#wallpaperControlsHandle');
    await page.click('#wallpaperOpenPreview');
    assert.equal(await page.evaluate(() => window.previewCount), 1);
    const drag = await page.$eval('#wallpaperControlsDrag', node => { const r = node.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
    await page.mouse.move(drag.x, drag.y);
    await page.mouse.down();
    await page.mouse.move(20, 300, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.$eval('#wallpaperControls', node => node.style.left), '0px');
    await page.$eval('#wallpaperVolume', node => { node.value = '64'; node.dispatchEvent(new Event('input')); });
    assert.equal(await page.evaluate(() => window.actualVolume), 64);
    await page.evaluate(() => { window.wallpaper = true; window.dispatchEvent(new Event('aasc-wallpaper-mode')); });
    assert.equal(await page.$eval('#wallpaperControls', node => node.hidden), true);
    await page.waitForFunction(() => document.getElementById('timeDisplay').getBoundingClientRect().top >= 30);
    for (const angle of [90, 180, 270, 0]) {
        await page.evaluate(value => {
            document.getElementById('timeDisplay').style.transform = `rotate(${value}deg)`;
            window.dispatchEvent(new Event('aasc-wallpaper-inset'));
        }, angle);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.waitForFunction(() => document.getElementById('timeDisplay').getBoundingClientRect().top >= 29.5);
    }
    assert.equal(await page.$eval('#displayInteractionLayer', node => getComputedStyle(node).visibility), 'hidden');
    await page.$eval('#displayVoiceAsrResult', node => { node.hidden = false; });
    assert.equal(await page.$eval('#displayVoiceAsrResult', node => getComputedStyle(node).visibility), 'visible');
    assert.equal(await page.$eval('#displayVoiceAsrResult', node => getComputedStyle(node).pointerEvents), 'none');
    assert.equal(await page.$eval('#normalControl', node => getComputedStyle(node).visibility), 'hidden');
    await page.$eval('#displayVoiceAsrResult', node => { node.hidden = true; });
    assert.equal(await page.$eval('#displayVoiceAsrResult', node => getComputedStyle(node).display), 'none');
    assert.ok(await page.$eval('#wallpaperControls', node => Number(getComputedStyle(node).zIndex) > 999999));
    const events = () => page.evaluate(() => {
        const target = document.getElementById('displayMmdFps');
        const received = [];
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'click']) {
            target.addEventListener(type, () => received.push(type), { once: true });
            target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
        }
        return received;
    });
    const expectedEvents = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'click'];
    assert.deepEqual(await events(), expectedEvents);
    await page.evaluate(() => window.WallpaperControls.setOption('contentInteraction', false));
    assert.equal(await page.$eval('#wallpaperInteractionShield', node => node.hidden), false);
    assert.equal(await page.evaluate(() => document.elementFromPoint(10, 10).id), 'wallpaperInteractionShield');
    assert.deepEqual(await events(), []);
    assert.equal(await page.evaluate(() => localStorage.getItem('aasc.wallpaper.contentInteraction')), 'false');
    await page.evaluate(() => { window.WallpaperControls.setOption('fps', false); window.WallpaperControls.setOption('time', false); });
    assert.equal(await page.$eval('#displayMmdFps', node => getComputedStyle(node).visibility), 'hidden');
    assert.equal(await page.$eval('#timeDisplay', node => getComputedStyle(node).visibility), 'hidden');
    await page.evaluate(() => { window.wallpaper = false; window.dispatchEvent(new Event('aasc-wallpaper-mode')); });
    assert.equal(await page.$eval('#wallpaperInteractionShield', node => node.hidden), true);
    assert.deepEqual(await events(), expectedEvents);
    assert.equal(await page.$eval('#wallpaperControls', node => node.hidden), false);
    assert.equal(await page.$eval('#displayInteractionLayer', node => getComputedStyle(node).visibility), 'visible');
    assert.equal(await page.$eval('#timeDisplay', node => getComputedStyle(node).visibility), 'visible');
    const restored = await browser.newPage();
    await restored.setContent(`<style>${css}</style>${panel}`);
    await restored.evaluate(() => {
        Object.defineProperty(window, 'localStorage', { value: { getItem: key => key === 'aasc.wallpaper.contentInteraction' ? 'false' : null, setItem: () => {} } });
        window.NativeDisplay = { isWallpaperActive: () => true };
    });
    await restored.addScriptTag({ path: path.join(dir, 'js/display-wallpaper-controls.js') });
    assert.equal(await restored.$eval('#wallpaperContentInteraction', node => node.checked), false);
    assert.equal(await restored.$eval('#wallpaperControls', node => node.hidden), false, '旧 APK 没有系统浮窗时保留壁纸网页面板');
});
