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
        window.DeviceMotionEvent = window.DeviceMotionEvent || function DeviceMotionEvent() {};
        window.DisplayMmd = { setHolographicTilt: value => { window.hologram = value; } };
        window.NativeDisplay = { isWallpaperActive: () => window.wallpaper, getWallpaperTopInset: () => 30,
            openWallpaperPreview: () => { window.previewCount++; }, getWallpaperMediaVolume: () => window.actualVolume, setWallpaperMediaVolume: value => { window.actualVolume = value; },
            setHolographicSensorEnabled: value => { window.sensorEnabled = value; return true; } };
        window.emitMotion = (x, y) => { const event = new Event('devicemotion'); Object.defineProperty(event, 'accelerationIncludingGravity', { value: { x, y, z: 9.80665 } }); Object.defineProperty(event, 'rotationRate', { value: { alpha: 0, beta: 0, gamma: 0 } }); window.dispatchEvent(event); };
    });
    const mmd = fs.readFileSync(path.join(dir, 'js/display-mmd.js'), 'utf8');
    const start = mmd.indexOf('    function setHolographicTilt(value = {}) {');
    const end = mmd.indexOf('    function setCameraViewRotation', start);
    assert.ok(start >= 0 && end > start);
    await page.evaluate(source => {
        const state = { holographicTilt: { modelYaw: 0, modelPitch: 0, cameraX: 0, cameraY: 0 },
            runtime: { setHolographicTilt: value => { window.runtimeHologram = { ...value }; } } };
        const publish = new Function('state', `${source}; return setHolographicTilt;`)(state);
        window.DisplayMmd.setHolographicTilt = value => { window.hologram = value; publish(value); };
    }, mmd.slice(start, end));
    await page.addScriptTag({ path: path.join(dir, 'js/display-wallpaper-motion.js') });
    await page.addScriptTag({ path: path.join(dir, 'js/display-wallpaper-controls.js') });
    assert.equal(await page.$eval('#wallpaperControls', node => node.hidden), false);
    assert.equal(await page.$eval('#wallpaperHologramModel', node => node.checked), false);
    assert.equal(await page.$eval('#wallpaperHologramCamera', node => node.checked), false);
    await page.$eval('#wallpaperHologramModel', node => { node.checked = true; node.dispatchEvent(new Event('change')); });
    assert.equal(await page.evaluate(() => window.sensorEnabled), true);
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 0, gamma: 0 } }));
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 5, gamma: 10 } }));
    });
    let tilt = await page.evaluate(() => window.hologram);
    assert.ok(Math.abs(tilt.modelYaw) > 0 && tilt.cameraX === 0);
    assert.ok(Math.abs(Math.abs(tilt.modelYaw) - 10 * Math.PI / 180) < 1e-10);
    assert.ok(Math.abs((await page.evaluate(() => window.runtimeHologram)).modelYaw - tilt.modelYaw) < 1e-10);
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = true; node.dispatchEvent(new Event('change')); });
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 0, gamma: 0 } }));
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 80, gamma: 170 } }));
    });
    tilt = await page.evaluate(() => window.hologram);
    assert.equal(Math.abs(tilt.modelYaw), 0.28); assert.equal(tilt.cameraX, 0);
    assert.equal(tilt.cameraY, 0);
    await page.$eval('#wallpaperHologramModel', node => { node.checked = false; node.dispatchEvent(new Event('change')); });
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 0, gamma: 0 } }));
        window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta: 10, gamma: 20 } }));
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    tilt = await page.evaluate(() => window.hologram);
    assert.equal(tilt.modelYaw ?? 0, 0); assert.equal(tilt.cameraX ?? 0, 0);
    // 横屏时线性加速度换算到屏幕横纵轴，倾斜事件不会驱动镜头。
    await page.evaluate(() => {
        Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { angle: 90 } });
        window.dispatchEvent(new Event('aasc-hologram-visibility'));
        window.emitMotion(0, 0);
        window.emitMotion(0, 4);
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    tilt = await page.evaluate(() => window.hologram);
    assert.ok(Math.abs(tilt.cameraX) > 0.001); assert.ok(Math.abs(tilt.cameraY) < 1e-8);
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.ok(Math.abs((await page.evaluate(() => window.hologram)).cameraX) < Math.abs(tilt.cameraX));
    await page.evaluate(() => { delete window.screen.orientation; });
    await page.evaluate(async () => {
        window.dispatchEvent(new Event('aasc-hologram-visibility'));
        window.emitMotion(0, 0);
        for (let i = 0; i < 6; i++) { window.emitMotion(0.05, 0); await new Promise(resolve => setTimeout(resolve, 30)); }
    });
    assert.equal((await page.evaluate(() => window.runtimeHologram)).cameraX, 0);
    // 连续的中等线性加速度应产生可见量级的偏移，而不是只验证非零。
    await page.evaluate(async () => {
        window.dispatchEvent(new Event('aasc-hologram-visibility'));
        window.emitMotion(0, 0);
        for (let i = 0; i < 10; i++) { window.emitMotion(1, 0); await new Promise(resolve => setTimeout(resolve, 30)); }
    });
    assert.ok((await page.evaluate(() => window.runtimeHologram.cameraX)) > 0.025);
    for (const [x, y, axis, direction] of [[4, 0, 'cameraX', 1], [-4, 0, 'cameraX', -1], [0, 4, 'cameraY', 1], [0, -4, 'cameraY', -1]]) {
        await page.evaluate(({ x, y }) => {
            window.dispatchEvent(new Event('aasc-hologram-visibility'));
            window.emitMotion(0, 0);
            window.emitMotion(x, y);
        }, { x, y });
        await new Promise(resolve => setTimeout(resolve, 100));
        const sample = await page.evaluate(() => window.hologram);
        assert.ok(sample[axis] * direction > 0.001, `手机移动方向 ${x},${y} 应推动 ${axis}`);
    }
    await page.evaluate(() => window.dispatchEvent(new Event('aasc-hologram-visibility')));
    assert.deepEqual(await page.evaluate(() => window.hologram), {});
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = false; node.dispatchEvent(new Event('change')); });
    assert.equal(await page.evaluate(() => window.sensorEnabled), false);
    assert.deepEqual(await page.evaluate(() => window.hologram), {});
    await page.evaluate(() => { window.DeviceMotionEvent = undefined; });
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = true; node.dispatchEvent(new Event('change')); });
    assert.match(await page.$eval('#wallpaperHologramStatus', node => node.textContent), /不支持手机移动传感器/);
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = false; node.dispatchEvent(new Event('change')); });
    await page.evaluate(() => {
        window.DeviceMotionEvent = function DeviceMotionEvent() {};
        const originalTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, ms, ...args) => ms === 5000 ? originalTimeout(callback, 20, ...args) : originalTimeout(callback, ms, ...args);
    });
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = true; node.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => document.getElementById('wallpaperHologramStatus').textContent.includes('未收到手机移动数据'));
    await page.$eval('#wallpaperHologramModel', node => { node.checked = true; node.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => document.getElementById('wallpaperHologramStatus').textContent.includes('未收到手机移动数据'));
    await page.evaluate(() => { for (const beta of [0, 10]) window.dispatchEvent(new CustomEvent('aasc-native-orientation', { detail: { beta, gamma: 0 } })); });
    assert.match(await page.$eval('#wallpaperHologramStatus', node => node.textContent), /未收到手机移动数据/);
    await page.$eval('#wallpaperHologramModel', node => { node.checked = false; node.dispatchEvent(new Event('change')); });
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
    // 壁纸使用原生加速度；即使网页事件仍到达，也不能重复驱动相机。
    await page.evaluate(() => {
        window.nativeMotionEnabled = false;
        window.NativeDisplay.setWallpaperMotionSensorEnabled = value => { window.nativeMotionEnabled = value; return true; };
    });
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = true; node.dispatchEvent(new Event('change')); });
    assert.equal(await page.evaluate(() => window.nativeMotionEnabled), true);
    await page.evaluate(() => { window.emitMotion(0, 0); window.emitMotion(4, 0); });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal((await page.evaluate(() => window.hologram)).cameraX ?? 0, 0);
    await page.evaluate(() => {
        const send = (x, y) => window.dispatchEvent(new CustomEvent('aasc-native-motion', { detail: { x, y, z: 9.80665 } }));
        send(0, 0); send(4, 0);
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok((await page.evaluate(() => window.hologram.cameraX)) > 0.001);
    await page.evaluate(() => window.dispatchEvent(new Event('aasc-native-motion-reset')));
    assert.equal(await page.evaluate(() => window.hologram.cameraX), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('aasc-native-motion-error')));
    assert.match(await page.$eval('#wallpaperHologramStatus', node => node.textContent), /无法启动/);
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = false; node.dispatchEvent(new Event('change')); });
    assert.equal(await page.evaluate(() => window.nativeMotionEnabled), false);
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
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = true; node.dispatchEvent(new Event('change')); });
    assert.equal(await page.evaluate(() => window.nativeMotionEnabled), false);
    await page.evaluate(() => {
        for (const x of [0, 4]) window.dispatchEvent(new CustomEvent('aasc-native-motion', { detail: { x, y: 0, z: 9.80665 } }));
    });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal((await page.evaluate(() => window.hologram.cameraX)) ?? 0, 0);
    await page.evaluate(() => { window.emitMotion(0, 0); window.emitMotion(4, 0); });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok((await page.evaluate(() => window.hologram.cameraX)) > 0.001);
    await page.$eval('#wallpaperHologramCamera', node => { node.checked = false; node.dispatchEvent(new Event('change')); });
    const restored = await browser.newPage();
    await restored.setContent(`<style>${css}</style>${panel}`);
    await restored.evaluate(() => {
        Object.defineProperty(window, 'localStorage', { value: { getItem: key => key === 'aasc.wallpaper.contentInteraction' ? 'false' : null, setItem: () => {} } });
        window.NativeDisplay = { isWallpaperActive: () => true };
        window.DeviceMotionEvent = window.DeviceMotionEvent || function DeviceMotionEvent() {};
        window.hologram = {};
        window.DisplayMmd = { setHolographicTilt: value => { window.hologram = value; } };
    });
    await restored.addScriptTag({ path: path.join(dir, 'js/display-wallpaper-motion.js') });
    await restored.addScriptTag({ path: path.join(dir, 'js/display-wallpaper-controls.js') });
    assert.equal(await restored.$eval('#wallpaperContentInteraction', node => node.checked), false);
    assert.equal(await restored.$eval('#wallpaperControls', node => node.hidden), false, '旧 APK 没有系统浮窗时保留壁纸网页面板');
    await restored.$eval('#wallpaperHologramCamera', node => { node.checked = true; node.dispatchEvent(new Event('change')); });
    await restored.evaluate(() => {
        for (const x of [0, 4]) {
            const event = new Event('devicemotion');
            Object.defineProperty(event, 'accelerationIncludingGravity', { value: { x, y: 0, z: 9.80665 } });
            window.dispatchEvent(event);
        }
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok((await restored.evaluate(() => window.hologram.cameraX)) > 0.001, '旧 APK 应继续采用网页事件');
});
