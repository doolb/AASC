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

test('TTS 背景透明度规范化默认值、1%步进和0–100%有效边界', () => {
    assert.equal(configService.getDefaultTtsBackgroundOpacity(), 0.2);
    assert.equal(configService.normalizeTtsBackgroundOpacity(undefined), 0.2);
    assert.equal(configService.normalizeTtsBackgroundOpacity(0.136), 0.14);
    assert.equal(configService.normalizeTtsBackgroundOpacity(-1), 0);
    assert.equal(configService.normalizeTtsBackgroundOpacity(1), 1);
    assert.equal(configService.normalizeTtsBackgroundOpacity(1.006), 1);
    assert.deepEqual(configService.validateTtsBackgroundOpacity(0), { ok: true, opacity: 0 });
    assert.deepEqual(configService.validateTtsBackgroundOpacity(0.2), { ok: true, opacity: 0.2 });
    assert.deepEqual(configService.validateTtsBackgroundOpacity(1), { ok: true, opacity: 1 });
    assert.equal(configService.validateTtsBackgroundOpacity('0.1').ok, false);
    assert.equal(configService.validateTtsBackgroundOpacity(-0.01).ok, false);
    assert.equal(configService.validateTtsBackgroundOpacity(1.01).ok, false);
});

test('TTS 背景透明度通过远端配置持久化、广播并在两端连接时补发', () => {
    assert.match(upload, /id="displayTtsBackgroundOpacity"[^>]+min="0" max="100" step="1" value="20"/);
    assert.match(upload, /String\(Math\.round\(this\.ttsBackgroundOpacity \* 100\)\)/);
    assert.match(upload, /const opacity = percent \/ 100;/);
    assert.match(upload, /opacity < 0 \|\| opacity > 1/);
    assert.match(display, /Number\.isFinite\(opacity\) && opacity >= 0 && opacity <= 1/);
    assert.match(selfTest, /Number\(input\.max\) === 100/);
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

test('控制端把百分比映射为 alpha 比例，并将权威比例映射回百分比', { timeout: 30000 }, async () => {
    const page = await browser.newPage();
    try {
        await page.setContent(`
            <input id="displayTtsBackgroundOpacity" type="range" min="0" max="100" step="1" value="20">
            <output id="displayTtsBackgroundOpacityValue">20%</output>
        `);
        const settingsDeclaration = upload.match(/    const Settings = \{[\s\S]*?\n    \};/);
        assert.ok(settingsDeclaration, '应能从正式控制页读取 Settings 实现');
        await page.addScriptTag({ content: `window.__opacitySettings = (() => { ${settingsDeclaration[0].trim()}; return Settings; })();` });
        const result = await page.evaluate(() => {
            const settings = window.__opacitySettings;
            const sent = [];
            window.WebSocketManager = { send: message => sent.push(message) };
            settings.updateUI();
            const input = document.getElementById('displayTtsBackgroundOpacity');
            input.value = '73';
            settings.previewTtsBackgroundOpacity();
            const preview = document.getElementById('displayTtsBackgroundOpacityValue').textContent;
            settings.saveTtsBackgroundOpacityConfig();
            settings.handleTtsBackgroundOpacityConfig({ opacity: 1 });
            return {
                preview,
                sent: sent[0],
                authoritativeInput: input.value,
                authoritativeOutput: document.getElementById('displayTtsBackgroundOpacityValue').textContent
            };
        });
        assert.equal(result.preview, '73%');
        assert.deepEqual(result.sent, { type: 'setDisplayTtsBackgroundOpacityConfig', opacity: 0.73 });
        assert.equal(result.authoritativeInput, '100');
        assert.equal(result.authoritativeOutput, '100%');
    } finally {
        await page.close();
    }
});

test('字幕背景渐变读取透明度变量且不改变4px背景模糊和文字不透明度', { timeout: 30000 }, async () => {
    const page = await browser.newPage();
    try {
        await page.setContent('<div id="voiceTextDisplay" data-voice-text-mode="tts">测试文字</div>');
        await page.addStyleTag({ content: displayCss });
        const result = await page.evaluate(() => {
            const element = document.getElementById('voiceTextDisplay');
            document.documentElement.style.setProperty('--tts-subtitle-background-opacity', '0.13');
            const partial = getComputedStyle(element);
            const partialBackground = partial.backgroundImage;
            document.documentElement.style.setProperty('--tts-subtitle-background-opacity', '1');
            const full = getComputedStyle(element);
            return { backgroundImage: partialBackground, fullBackgroundImage: full.backgroundImage,
                backdropFilter: partial.backdropFilter, color: partial.color, opacity: partial.opacity };
        });
        assert.match(result.backgroundImage, /rgba\(0, 0, 0, 0\.13\)/);
        assert.match(result.fullBackgroundImage, /(?:rgba\(0, 0, 0, 1\)|rgb\(0, 0, 0\))/);
        assert.equal(result.backdropFilter, 'blur(4px)');
        assert.equal(result.opacity, '1', '透明度只作用于字幕背景，不淡化文字');
    } finally {
        await page.close();
    }
});
