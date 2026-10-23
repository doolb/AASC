'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const read = file => fs.readFileSync(path.join(publicDir, file), 'utf8');

async function browserPage(t) {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    t.after(() => browser.close());
    return browser.newPage();
}

test('真实浏览器：单轨双手柄拖动、释放提交、键盘与显示端隔离', { timeout: 30000 }, async t => {
    const page = await browserPage(t);
    await page.setViewport({ width: 390, height: 600 });
    const $ = cheerio.load(read('upload.html'));
    const section = $('#mediaLoopRange').closest('.control-item').html();
    await page.setContent(`<div class="control-item" style="width:320px;padding:20px">${section}</div>`);
    await page.addStyleTag({ content: read('css/upload.css') + read('css/theme.css') });
    await page.addScriptTag({ path: path.join(publicDir, 'js/media-loop.js') });
    await page.addScriptTag({ path: path.join(publicDir, 'js/control-media-loop.js') });
    await page.evaluate(() => {
        window.currentDisplayId = 'one';
        window.sent = [];
        window.WebSocketManager = { sendControl: (action, value) => sent.push({ action, value }) };
        ControlMediaLoop.init();
        ControlMediaLoop.restore('one', { currentMedia: { mediaType: 'video' }, currentMediaProgress: { duration: 120 }, mediaLoopToken: 'token' });
    });
    assert.equal(await page.$$eval('.media-loop-track', tracks => tracks.length), 1);
    const box = await page.$eval('#mediaLoopRange', element => {
        const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const x = pct => box.x + 10 + (box.width - 20) * pct / 100;
    const y = box.y + box.height / 2;
    await page.mouse.move(x(0), y);
    await page.mouse.down();
    await page.mouse.move(x(25), y, { steps: 10 });
    assert.equal(await page.evaluate(() => sent.length), 0, '拖动中仅预览');
    assert.match(await page.$eval('#mediaLoopStartTime', element => element.textContent), /00:30/);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => sent.length), 1);
    await page.mouse.move(x(100), y);
    await page.mouse.down();
    await page.mouse.move(x(75), y, { steps: 10 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => sent.length), 2);
    await page.click('#mediaLoopEnabled');
    assert.deepEqual(await page.evaluate(() => sent.at(-1)), { action: 'mediaLoop',
        value: { enabled: true, startPercent: 25, endPercent: 75, mediaLoopToken: 'token' } });
    await page.focus('#mediaLoopStart');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    assert.ok(await page.evaluate(() => ControlMediaLoop.range.startPercent < ControlMediaLoop.range.endPercent));
    const previous = await page.evaluate(() => ControlMediaLoop.range);
    await page.evaluate(() => ControlMediaLoop.receive({ displayId: 'other', mediaLoopToken: 'wrong', mediaLoop: { enabled: false }, duration: 30 }));
    assert.deepEqual(await page.evaluate(() => ControlMediaLoop.range), previous);
    await page.evaluate(() => ControlMediaLoop.receive({ displayId: 'one', mediaLoopToken: 'new', mediaLoop: {}, duration: 0 }));
    assert.equal(await page.$eval('#mediaLoopStart', input => input.disabled), true);
    await page.evaluate(() => {
        ControlMediaLoop.receive({ displayId: 'one', mediaLoopToken: 'new', mediaLoop: { enabled: true, startPercent: 20, endPercent: 80 }, duration: 120 });
        document.activeElement.blur();
    });
    const cdp = await page.createCDPSession();
    const countBeforeTouch = await page.evaluate(() => sent.length);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x(20), y }] });
    for (const percent of [25, 30, 35, 40]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x(percent), y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(await page.evaluate(() => ControlMediaLoop.range.startPercent >= 39), '触屏可拖动开始手柄');
    assert.equal(await page.evaluate(() => sent.length), countBeforeTouch + 1);
    await page.addScriptTag({ path: path.join(publicDir, 'js/websocket.js') });
    await page.evaluate(() => WebSocketManager.handleMessage({ type: 'mediaLoopState', displayId: 'one',
        mediaLoopToken: 'new', mediaLoop: { enabled: true, startPercent: 20, endPercent: 80 }, duration: 120 }));
    assert.equal(await page.$eval('#mediaLoopStart', input => Number(input.value)), 20);
    await page.addScriptTag({ path: path.join(publicDir, 'js/self-test.js') });
    const selfTest = await page.evaluate(() => SelfTest.tests.find(test => test.id === 'media_loop_range').run());
    assert.equal(selfTest.success, true);
    await page.screenshot({ path: path.join(__dirname, '../tmp/media-loop-control.png') });
    await page.evaluate(() => ControlMediaLoop.disconnected());
    assert.equal(await page.$eval('#mediaLoopEnabled', input => input.disabled), true);
});

for (const mediaType of ['video', 'audio']) {
    test(`真实${mediaType}解码：结束回跳、暂停保持、全长末尾优先于列表、关闭恢复`, { timeout: 30000 }, async t => {
        const page = await browserPage(t);
        const args = mediaType === 'video'
            ? ['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10', '-t', '3', '-c:v', 'libvpx', '-f', 'webm']
            : ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '3', '-f', 'wav'];
        const bytes = execFileSync('ffmpeg', ['-v', 'error', ...args, 'pipe:1']);
        await page.setContent(`<${mediaType} id="media" muted></${mediaType}>`);
        await page.addScriptTag({ path: path.join(publicDir, 'js/media-loop.js') });
        await page.evaluate(async (url) => {
            const media = document.getElementById('media');
            window.player = MediaLoop.attach(media);
            media.src = url;
            await new Promise(resolve => media.addEventListener('loadedmetadata', resolve, { once: true }));
            media.loop = true;
            player.set({ enabled: true, startPercent: 20, endPercent: 60 });
            window.loopbacks = 0;
            let previous = 0;
            media.addEventListener('timeupdate', () => { if (previous > media.currentTime + 0.3) loopbacks++; previous = media.currentTime; });
            await media.play();
        }, `data:${mediaType}/${mediaType === 'video' ? 'webm' : 'wav'};base64,${bytes.toString('base64')}`);
        await page.waitForFunction(() => loopbacks >= 1, { timeout: 12000 });
        const state = await page.evaluate(() => {
            const media = document.getElementById('media');
            media.pause();
            media.currentTime = media.duration * 0.9;
            return { position: media.currentTime, paused: media.paused, loop: media.loop };
        });
        await new Promise(resolve => setTimeout(resolve, 200));
        const pausedPosition = await page.$eval('#media', media => media.currentTime);
        assert.equal(state.paused, true);
        assert.equal(state.loop, false);
        assert.ok(Math.abs(pausedPosition - state.position) < 0.1);
        await page.evaluate(async () => {
            const media = document.getElementById('media');
            window.advanced = false;
            media.addEventListener('ended', () => { advanced = true; });
            player.set({ enabled: true, startPercent: 20, endPercent: 100 });
            await media.play();
            media.currentTime = media.duration - 0.1;
        });
        await page.waitForFunction(() => document.getElementById('media').currentTime < 1, { timeout: 5000 });
        assert.equal(await page.evaluate(() => advanced), false);
        await page.evaluate(() => { const media = document.getElementById('media'); media.pause(); player.reset(); });
        assert.equal(await page.$eval('#media', media => media.loop), true);
    });
}
