'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('../node_modules/puppeteer');

const publicRoot = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const read = name => fs.readFileSync(path.join(publicRoot, name), 'utf8');
const pickerScript = read('js/android-color-picker.js');
const pickerCss = read('css/android-color-picker.css');
const glowScript = read('js/display-background-glow.js');
const displayHtml = read('display.html');
const uploadHtml = read('upload.html');
let browser;

before(async () => {
    browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu']
    });
});

after(async () => { if (browser) await browser.close(); });

test('双端加载同一组件并覆盖全部原有颜色入口', () => {
    assert.equal((displayHtml.match(/\stype="color"/gu) || []).length, 8);
    assert.equal((uploadHtml.match(/\stype="color"/gu) || []).length, 1);
    for (const html of [displayHtml, uploadHtml]) {
        assert.match(html, /css\/android-color-picker\.css/u);
        assert.match(html, /js\/android-color-picker\.js/u);
    }
});

test('PC 保留原生颜色输入', async () => {
    const page = await browser.newPage();
    try {
        await page.setContent('<input id="color" type="color" value="#8fa8d5">');
        await page.addScriptTag({ content: pickerScript });
        const result = await page.evaluate(() => ({ type: document.getElementById('color').type,
            overlayCount: document.querySelectorAll('.android-color-overlay').length }));
        assert.deepEqual(result, { type: 'color', overlayCount: 0 });
    } finally { await page.close(); }
});

test('Android 色域、色相、HEX、确认与取消维持光晕事件契约', async () => {
    const page = await browser.newPage();
    try {
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36');
        await page.setViewport({ width: 390, height: 360, isMobile: true, hasTouch: true });
        await page.setContent(`<label for="displayAppearanceGlowColor">中心颜色</label>
            <input id="displayAppearanceGlowColor" type="color" value="#8FA8D5">
            <output id="displayAppearanceGlowColorValue"></output>
            <input id="displayAppearanceGlowCenterRange" type="range" value="10">
            <output id="displayAppearanceGlowCenterRangeValue"></output>
            <input id="displayAppearanceGlowSpread" type="range" value="58">
            <output id="displayAppearanceGlowSpreadValue"></output>
            <output id="displayAppearanceGlowStatus"></output>`);
        await page.addStyleTag({ content: pickerCss });
        await page.evaluate(() => {
            window.__sent = [];
            window.DisplayStage = { send: data => { window.__sent.push(data); return true; } };
        });
        await page.addScriptTag({ content: glowScript });
        await page.evaluate(() => window.DisplayBackgroundGlow.init());
        await page.addScriptTag({ content: pickerScript });
        const remoteSwatch = await page.evaluate(() => {
            document.getElementById('displayAppearanceGlowColor').value = '#223344';
            return document.querySelector('.android-color-trigger').style.getPropertyValue('--android-color-value');
        });
        assert.equal(remoteSwatch, '#223344');
        await page.evaluate(() => { document.getElementById('displayAppearanceGlowColor').value = '#8FA8D5'; });
        const trigger = '.android-color-trigger';
        await page.click(trigger);
        const initial = await page.evaluate(() => ({ type: document.getElementById('displayAppearanceGlowColor').type,
            color: document.querySelector('.android-color-hex').value,
            hueTrack: getComputedStyle(document.querySelector('.android-color-hue'), '::-webkit-slider-runnable-track').backgroundImage,
            bounds: (() => {
                const rect = document.querySelector('.android-color-dialog').getBoundingClientRect();
                return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
            })() }));
        assert.equal(initial.type, 'hidden');
        assert.equal(initial.color, '#8FA8D5');
        assert.equal(initial.bounds, true);
        assert.match(initial.hueTrack, /linear-gradient/u);

        await page.$eval('.android-color-hue', input => {
            input.value = '120';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const square = await page.$('.android-color-square');
        const rect = await square.boundingBox();
        await page.touchscreen.tap(rect.x + rect.width * 0.7, rect.y + rect.height * 0.2);
        const gesturePreview = await page.$eval('#displayAppearanceGlowColor', input => input.value);
        assert.match(gesturePreview, /^#[0-9a-f]{6}$/iu);
        await page.$eval('.android-color-hex', input => {
            input.value = '112233';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.equal(await page.$eval('#displayAppearanceGlowColor', input => input.value.toUpperCase()), '#112233');
        assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--display-background-glow-center-color')), '#112233');
        await page.click('.android-color-cancel');
        const cancelled = await page.evaluate(() => ({ value: document.getElementById('displayAppearanceGlowColor').value.toUpperCase(),
            sent: window.__sent.length, open: !document.querySelector('.android-color-overlay').hidden }));
        assert.deepEqual(cancelled, { value: '#8FA8D5', sent: 0, open: false });

        await page.click(trigger);
        await page.$eval('.android-color-hex', input => {
            input.value = '#445566';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.click('.android-color-confirm');
        const confirmed = await page.evaluate(() => ({ value: document.getElementById('displayAppearanceGlowColor').value.toUpperCase(),
            sent: window.__sent, open: !document.querySelector('.android-color-overlay').hidden }));
        assert.deepEqual(confirmed, { value: '#445566', open: false,
            sent: [{ type: 'setDisplayBackgroundGlowConfig',
                config: { color: '#445566', centerRange: 10, spread: 58 } }] });
    } finally { await page.close(); }
});

test('Android 非法 HEX 不能确认，Escape 回退且所有显示端颜色共用弹层', async () => {
    const page = await browser.newPage();
    try {
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36');
        const inputs = [...displayHtml.matchAll(/<input[^>]*type="color"[^>]*>/gu)].map(match => match[0]);
        await page.setContent(inputs.join(''));
        await page.addScriptTag({ content: pickerScript });
        assert.equal(await page.$$eval('.android-color-trigger', elements => elements.length), 8);
        assert.equal(await page.$$eval('.android-color-overlay', elements => elements.length), 1);
        await page.click('.android-color-trigger');
        await page.$eval('.android-color-hex', input => {
            input.value = '#nothex';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.equal(await page.$eval('.android-color-confirm', button => button.disabled), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('.android-color-overlay', overlay => overlay.hidden), true);
    } finally { await page.close(); }
});

test('Android 控制端原颜色控件继续经 WebSocket 保存', async () => {
    const page = await browser.newPage();
    try {
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36');
        await page.setContent(`<label for="displayBackgroundGlowColor">中心颜色</label>
            <input id="displayBackgroundGlowColor" type="color" value="#8FA8D5">
            <output id="displayBackgroundGlowColorValue"></output>
            <input id="displayBackgroundGlowCenterRange" type="range" value="10">
            <output id="displayBackgroundGlowCenterRangeValue"></output>
            <input id="displayBackgroundGlowSpread" type="range" value="58">
            <output id="displayBackgroundGlowSpreadValue"></output>`);
        await page.evaluate(() => {
            window.__sent = [];
            window.WebSocketManager = { ws: { readyState: 1,
                send: text => window.__sent.push(JSON.parse(text)) } };
        });
        await page.addScriptTag({ content: glowScript });
        await page.evaluate(() => window.DisplayBackgroundGlow.init());
        await page.addScriptTag({ content: pickerScript });
        await page.click('label[for="displayBackgroundGlowColor"]');
        await page.$eval('.android-color-hex', input => {
            input.value = '#CC8844';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.click('.android-color-confirm');
        assert.deepEqual(await page.evaluate(() => window.__sent), [{
            type: 'setDisplayBackgroundGlowConfig',
            config: { color: '#CC8844', centerRange: 10, spread: 58 }
        }]);
    } finally { await page.close(); }
});
