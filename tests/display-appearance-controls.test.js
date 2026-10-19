'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('../node_modules/puppeteer');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const display = read('src/apps/web-mediacenter/ui/public/display.html');
const server = read('src/apps/server/boot/server-app.js');
const controlSocket = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
const appearanceScript = read('src/apps/web-mediacenter/ui/public/js/display-appearance-controls.js');
const glowScript = read('src/apps/web-mediacenter/ui/public/js/display-background-glow.js');
const displayMmdCss = read('src/apps/web-mediacenter/ui/public/css/display-mmd.css');
const panel = display.match(/<button id="displayAppearanceToggle"[\s\S]*?<\/section>\s*(?=<button id="displayTtsVoiceToggle")/u)?.[0];
const voiceButton = display.match(/<button id="displayTtsVoiceToggle"[\s\S]*?<\/button>/u)?.[0];
let browser;

before(async () => {
    browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu']
    });
});

after(async () => {
    if (browser) await browser.close();
});

test('主题按钮位于音色上方且面板使用现有主题列表，服务端广播权威值', () => {
    assert.ok(panel, '音色按钮上方应有外观面板');
    assert.match(display, /<div class="display-stage-lighting-control" hidden>\s*<button id="displayAppearanceToggle"/u);
    assert.ok(display.indexOf('displayAppearanceToggle') < display.indexOf('displayTtsVoiceToggle'));
    const optionCount = (panel.match(/<option value=/gu) || []).length;
    assert.equal(optionCount, 15);
    for (const id of ['displayAppearanceGlowColor', 'displayAppearanceGlowCenterRange', 'displayAppearanceGlowSpread']) {
        assert.match(panel, new RegExp(`id="${id}"`, 'u'));
    }
    assert.match(server, /displayTypes:[^\n]*'setDisplayBackgroundGlowConfig'/u);
    assert.match(server, /displayClients\.get\(displayId\)\?\.ws !== ws[\s\S]*?setDisplayBackgroundGlowConfig: saveDisplayBackgroundGlowConfig/u);
    assert.match(server, /displayTypes:[^\n]*'setControlThemeConfig'[^\n]*'setDisplayTtsBackgroundOpacityConfig'/u);
    assert.match(server, /displayClients\.get\(displayId\)\?\.ws !== ws/u);
    assert.match(server, /function broadcastControlTheme\(theme\)[\s\S]*broadcastToControls\(\{ type: 'controlThemeChanged', theme \}\)/u);
    assert.match(controlSocket, /controlThemeChanged: data => window\.UiTheme\?\.applyRemoteTheme\(data\.theme\)/u);
    assert.match(display, /socket\.onclose = function\(\)[\s\S]*DisplayAppearanceControls\?\.handleDisconnected\(\)/u);
    assert.match(appearanceScript, /addEventListener\('DOMContentLoaded', init/u);
});

test('窄屏主题面板可编辑光晕并向服务器提交共享配置', async () => {
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 390, height: 320 });
        await page.setContent(`<div id="displayStageLayers" class="display-stage-layers"><div class="display-interaction-layer"><div class="display-stage-lighting-control">${panel}${voiceButton}</div></div></div>`);
        await page.addStyleTag({ content: displayMmdCss });
        await page.evaluate(() => {
            window.__sent = [];
            window.DisplayStage = { send: message => { window.__sent.push(message); return true; } };
        });
        await page.addScriptTag({ content: glowScript });
        const result = await page.evaluate(() => {
            window.DisplayBackgroundGlow.init();
            const panelNode = document.getElementById('displayAppearancePanel');
            panelNode.hidden = false;
            const color = document.getElementById('displayAppearanceGlowColor');
            const range = document.getElementById('displayAppearanceGlowCenterRange');
            const spread = document.getElementById('displayAppearanceGlowSpread');
            color.value = '#B4C8EF';
            range.value = '14';
            spread.value = '66';
            range.dispatchEvent(new Event('input', { bubbles: true }));
            const preview = document.documentElement.style.getPropertyValue('--display-background-glow-center-range');
            spread.dispatchEvent(new Event('change', { bubbles: true }));
            const rect = panelNode.getBoundingClientRect();
            return { preview, sent: window.__sent, status: document.getElementById('displayAppearanceGlowStatus').textContent,
                inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
                scrollable: panelNode.scrollHeight > panelNode.clientHeight };
        });
        assert.equal(result.preview, '14%');
        assert.deepEqual(result.sent, [{ type: 'setDisplayBackgroundGlowConfig',
            config: { color: '#B4C8EF', centerRange: 14, spread: 66 } }]);
        assert.equal(result.status, '正在保存光晕…');
        assert.equal(result.inViewport, true);
        assert.equal(result.scrollable, true);
    } finally {
        await page.close();
    }
});

test('显示端面板展开、保存、预览、权威回显及断线恢复', async () => {
    const page = await browser.newPage();
    try {
        await page.setContent(`<div id="displayStageLayers" class="display-stage-layers"><div class="display-interaction-layer"><div class="display-stage-lighting-control">${panel}${voiceButton}</div></div></div>`);
        await page.addStyleTag({ content: displayMmdCss });
        await page.evaluate(() => {
            window.__sent = [];
            window.__connected = true;
            window.UiTheme = {
                themes: ['dark', 'light', 'warm', 'pink', 'lavender-yellow', 'red-blue', 'gold',
                    'mint', 'ocean', 'forest', 'slate', 'algae-salt', 'girl-pink', 'rose-gold', 'new-year-red'],
                normalize: theme => theme || 'dark'
            };
            window.DisplayStage = {
                send: message => {
                    if (!window.__connected) return false;
                    window.__sent.push(message);
                    return true;
                }
            };
        });
        await page.addScriptTag({ content: appearanceScript });
        const result = await page.evaluate(() => {
            const controls = window.DisplayAppearanceControls;
            document.getElementById('displayAppearanceToggle').click();
            const opened = !document.getElementById('displayAppearancePanel').hidden;
            const themeRect = document.getElementById('displayAppearanceToggle').getBoundingClientRect();
            const voiceRect = document.getElementById('displayTtsVoiceToggle').getBoundingClientRect();
            const panelRect = document.getElementById('displayAppearancePanel').getBoundingClientRect();
            const placement = { themeAboveVoice: themeRect.bottom < voiceRect.top,
                panelLeftOfButtons: panelRect.right < themeRect.left };
            const theme = document.getElementById('displayAppearanceTheme');
            theme.value = 'mint';
            theme.dispatchEvent(new Event('change', { bubbles: true }));
            const opacity = document.getElementById('displayAppearanceTtsOpacity');
            opacity.value = '73';
            opacity.dispatchEvent(new Event('input', { bubbles: true }));
            const preview = document.documentElement.style.getPropertyValue('--tts-subtitle-background-opacity');
            opacity.dispatchEvent(new Event('change', { bubbles: true }));
            controls.handleTheme('mint');
            controls.handleOpacity(0.73);
            const authoritative = { theme: theme.value, opacity: opacity.value,
                label: document.getElementById('displayAppearanceTtsOpacityValue').textContent };
            opacity.value = '40';
            opacity.dispatchEvent(new Event('input', { bubbles: true }));
            opacity.dispatchEvent(new Event('change', { bubbles: true }));
            controls.handleDisconnected();
            const pendingReverted = { opacity: opacity.value,
                status: document.getElementById('displayAppearanceStatus').textContent };
            window.__connected = false;
            theme.value = 'ocean';
            theme.dispatchEvent(new Event('change', { bubbles: true }));
            opacity.value = '30';
            opacity.dispatchEvent(new Event('input', { bubbles: true }));
            opacity.dispatchEvent(new Event('change', { bubbles: true }));
            return {
                opened,
                placement,
                expanded: document.getElementById('displayAppearanceToggle').getAttribute('aria-expanded'),
                sent: window.__sent,
                preview,
                authoritative,
                pendingReverted,
                reverted: { theme: theme.value, opacity: opacity.value,
                    cssOpacity: document.documentElement.style.getPropertyValue('--tts-subtitle-background-opacity') }
            };
        });
        assert.equal(result.opened, true);
        assert.deepEqual(result.placement, { themeAboveVoice: true, panelLeftOfButtons: true });
        assert.equal(result.expanded, 'true');
        assert.deepEqual(result.sent, [
            { type: 'setControlThemeConfig', theme: 'mint' },
            { type: 'setDisplayTtsBackgroundOpacityConfig', opacity: 0.73 },
            { type: 'setDisplayTtsBackgroundOpacityConfig', opacity: 0.4 }
        ]);
        assert.equal(result.preview, '0.73');
        assert.deepEqual(result.authoritative, { theme: 'mint', opacity: '73', label: '73%' });
        assert.deepEqual(result.pendingReverted, { opacity: '73', status: '连接已断开，设置未保存' });
        assert.deepEqual(result.reverted, { theme: 'mint', opacity: '73', cssOpacity: '0.73' });
    } finally {
        await page.close();
    }
});
