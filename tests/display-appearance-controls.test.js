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
const panel = display.match(/<div class="display-appearance-control">[\s\S]*?<\/div>\s*(?=<button id="displayChatToggle")/u)?.[0];
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

test('显示端主题面板用现有主题列表，服务端为控制端和显示端广播权威值', () => {
    assert.ok(panel, '显示端左下角应有外观面板');
    assert.ok(display.indexOf('displayAppearanceToggle') < display.indexOf('displayChatToggle'));
    const optionCount = (panel.match(/<option value=/gu) || []).length;
    assert.equal(optionCount, 15);
    assert.match(server, /displayTypes:[^\n]*'setControlThemeConfig'[^\n]*'setDisplayTtsBackgroundOpacityConfig'/u);
    assert.match(server, /displayClients\.get\(displayId\)\?\.ws !== ws/u);
    assert.match(server, /function broadcastControlTheme\(theme\)[\s\S]*broadcastToControls\(\{ type: 'controlThemeChanged', theme \}\)/u);
    assert.match(controlSocket, /controlThemeChanged: data => window\.UiTheme\?\.applyRemoteTheme\(data\.theme\)/u);
    assert.match(display, /socket\.onclose = function\(\)[\s\S]*DisplayAppearanceControls\?\.handleDisconnected\(\)/u);
    assert.match(appearanceScript, /addEventListener\('DOMContentLoaded', init/u);
});

test('显示端面板展开、保存、预览、权威回显及断线恢复', async () => {
    const page = await browser.newPage();
    try {
        await page.setContent(panel);
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
