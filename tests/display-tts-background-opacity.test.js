'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('../node_modules/puppeteer');
const configService = require('../src/apps/server/modules/config/config-app-service');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const server = read('src/apps/server/boot/server-app.js');
const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
const controlSocket = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
const display = read('src/apps/web-mediacenter/ui/public/display.html');
const displayCss = read('src/apps/web-mediacenter/ui/public/css/display.css');
const selfTest = read('src/apps/web-mediacenter/ui/public/js/self-test.js');
let browser;

before(async () => {
    browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true,
        timeout: 20000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu']
    });
});

after(async () => {
    if (!browser) return;
    const closePromise = browser.close().catch(() => {});
    const closed = await Promise.race([
        closePromise.then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 5000))
    ]);
    if (!closed) browser.process()?.kill();
});

test('TTS 背景透明度规范化默认值、步进和有效边界', () => {
    assert.equal(configService.getDefaultTtsBackgroundOpacity(), 0.2);
    assert.equal(configService.normalizeTtsBackgroundOpacity(undefined), 0.2);
    assert.equal(configService.normalizeTtsBackgroundOpacity(0.136), 0.14);
    assert.equal(configService.normalizeTtsBackgroundOpacity(-1), 0);
    assert.equal(configService.normalizeTtsBackgroundOpacity(1), 0.2);
    assert.deepEqual(configService.validateTtsBackgroundOpacity(0), { ok: true, opacity: 0 });
    assert.deepEqual(configService.validateTtsBackgroundOpacity(0.2), { ok: true, opacity: 0.2 });
    assert.equal(configService.validateTtsBackgroundOpacity('0.1').ok, false);
    assert.equal(configService.validateTtsBackgroundOpacity(0.21).ok, false);
});

test('TTS 背景透明度通过远端配置持久化、广播并在两端连接时补发', () => {
    assert.match(upload, /id="displayTtsBackgroundOpacity"[^>]+min="0" max="0\.2" step="0\.01" value="0\.2"/);
    assert.ok(upload.indexOf('displayBackgroundGlowPreview') < upload.indexOf('displayTtsBackgroundOpacity'),
        'TTS 透明度应位于背景光晕设置之后');
    assert.match(upload, /type: 'setDisplayTtsBackgroundOpacityConfig'/);
    assert.match(controlSocket, /displayTtsBackgroundOpacityConfig/);
    assert.match(display, /--tts-subtitle-background-opacity/);
    assert.match(server, /'setDisplayTtsBackgroundOpacityConfig'/);
    assert.match(server, /config\.set\('ui\.displayTtsBackgroundOpacity', validation\.opacity\)/);
    assert.match(server, /broadcastDisplayTtsBackgroundOpacity\(validation\.opacity\)/);
    assert.match(server, /type: 'displayTtsBackgroundOpacityConfig',[\s\S]{0,120}opacity: getDisplayTtsBackgroundOpacity\(\)/);
    assert.doesNotMatch(server, /\/api\/config\/displayTtsBackgroundOpacity/);
    assert.match(selfTest, /id: 'display_tts_background_opacity'/);
});

test('字幕背景渐变读取透明度变量且不改变4px背景模糊和文字不透明度', { timeout: 30000 }, async () => {
    const page = await browser.newPage();
    try {
        await page.setContent('<div id="voiceTextDisplay" data-voice-text-mode="tts">测试文字</div>');
        await page.addStyleTag({ content: displayCss });
        const result = await page.evaluate(() => {
            const element = document.getElementById('voiceTextDisplay');
            document.documentElement.style.setProperty('--tts-subtitle-background-opacity', '0.13');
            const style = getComputedStyle(element);
            return { backgroundImage: style.backgroundImage, backdropFilter: style.backdropFilter,
                color: style.color, opacity: style.opacity };
        });
        assert.match(result.backgroundImage, /rgba\(0, 0, 0, 0\.13\)/);
        assert.equal(result.backdropFilter, 'blur(4px)');
        assert.equal(result.opacity, '1', '透明度只作用于字幕背景，不淡化文字');
    } finally {
        await page.close();
    }
});
