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
    const panel = html.slice(html.indexOf('    <aside id="wallpaperControls"'), html.indexOf('    </aside>') + '    </aside>'.length);
    const css = fs.readFileSync(path.join(dir, 'css/display-wallpaper-controls.css'), 'utf8');
    await page.setContent(`<style>${css} #timeDisplay { position: fixed; top: 0; right: 0; }</style><div id="timeDisplay">12:00</div>${panel}<div id="connectionStatus">已连接</div><div id="voiceStatus">监听中</div><div id="displayStageLayers"><div id="displayInteractionLayer">按钮</div><div id="displayMmdFps">60 FPS</div></div>`);
    await page.evaluate(() => {
        window.wallpaper = false; window.actualVolume = 36;
        window.NativeDisplay = { isWallpaperActive: () => window.wallpaper, getWallpaperTopInset: () => 30,
            getWallpaperMediaVolume: () => window.actualVolume, setWallpaperMediaVolume: value => { window.actualVolume = value; } };
    });
    await page.addScriptTag({ path: path.join(dir, 'js/display-wallpaper-controls.js') });
    assert.equal(await page.$eval('#wallpaperControls', node => node.hidden), true);
    await page.evaluate(() => { window.wallpaper = true; window.dispatchEvent(new Event('aasc-wallpaper-mode')); });
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
    await page.click('#wallpaperControlsHandle');
    const drag = await page.$eval('#wallpaperControlsDrag', node => { const r = node.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
    await page.mouse.move(drag.x, drag.y);
    await page.mouse.down();
    await page.mouse.move(20, 300, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.$eval('#wallpaperControls', node => node.style.left), '0px');
    await page.click('#wallpaperControlsCollapse');
    assert.equal(await page.$eval('#wallpaperControlsPanel', node => node.hidden), true);
    await page.click('#wallpaperControlsHandle');
    await page.$eval('#wallpaperVolume', node => { node.value = '64'; node.dispatchEvent(new Event('input')); });
    assert.equal(await page.evaluate(() => window.actualVolume), 64);
    await page.click('#wallpaperShowFps');
    await page.click('#wallpaperShowTime');
    assert.equal(await page.$eval('#displayMmdFps', node => getComputedStyle(node).visibility), 'hidden');
    assert.equal(await page.$eval('#timeDisplay', node => getComputedStyle(node).visibility), 'hidden');
    await page.evaluate(() => { window.wallpaper = false; window.dispatchEvent(new Event('aasc-wallpaper-mode')); });
    assert.equal(await page.$eval('#wallpaperControls', node => node.hidden), true);
    assert.equal(await page.$eval('#displayInteractionLayer', node => getComputedStyle(node).visibility), 'visible');
    assert.equal(await page.$eval('#timeDisplay', node => getComputedStyle(node).visibility), 'visible');
});
