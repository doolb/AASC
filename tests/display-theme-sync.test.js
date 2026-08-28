'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '../src/apps/web-mediacenter/ui/public');
const display = fs.readFileSync(path.join(root, 'display.html'), 'utf8');
const displayCss = fs.readFileSync(path.join(root, 'css/display.css'), 'utf8');
const themeCss = fs.readFileSync(path.join(root, 'css/theme.css'), 'utf8');
const server = fs.readFileSync(
    path.join(__dirname, '../src/apps/server/boot/server-app.js'),
    'utf8'
);

test('显示端应加载共享主题并处理服务端主题通知', () => {
    assert.match(display, /css\/theme\.css/u);
    assert.match(display, /js\/ui-theme\.js/u);
    assert.match(display, /UiTheme\.init\(\)/u);
    assert.match(display, /data\.type === 'controlThemeChanged'[\s\S]*UiTheme\.applyRemoteTheme\(data\.theme\)/u);
    assert.match(server, /type: 'controlThemeChanged'[\s\S]*theme/u);
    assert.match(server, /displayClients\.forEach\([\s\S]*controlThemeChanged/u);
});

test('显示端媒体底色应固定为黑色，UI 控件仍使用共享主题变量', () => {
    const pageBackground = displayCss.match(/html, body\s*\{([\s\S]*?)\}/u)?.[1] || '';
    const mediaContainerBackground = displayCss.match(/#mediaContainer\s*\{([\s\S]*?)\}/u)?.[1] || '';
    const mediaSleepOverlayBackground = displayCss.match(/\.sleep-overlay\s*\{([\s\S]*?)\}/u)?.[1] || '';

    assert.match(pageBackground, /background:\s*#000\b/u);
    assert.doesNotMatch(pageBackground, /var\(--bg-primary/u);
    assert.match(mediaContainerBackground, /background:\s*#000\b/u);
    assert.doesNotMatch(mediaContainerBackground, /var\(--bg-primary/u);
    assert.match(mediaSleepOverlayBackground, /background:\s*#000\b/u);
    assert.match(displayCss, /#mediaText[\s\S]*background:\s*var\(--bg-secondary(?:,\s*[^)]+)?\)/u);
    assert.match(displayCss, /#mediaText[\s\S]*color:\s*var\(--text-primary(?:,\s*[^)]+)?\)/u);
    const timeDisplay = displayCss.match(/#timeDisplay\s*\{([\s\S]*?)\}/u)?.[1] || '';
    const fileNameDisplay = displayCss.match(/#fileNameDisplay\s*\{([\s\S]*?)\}/u)?.[1] || '';
    assert.match(timeDisplay, /color:\s*rgba\(255,\s*255,\s*255,\s*0\.9\)/u);
    assert.match(timeDisplay, /2px\s+2px\s+8px\s+rgba\(0,\s*0,\s*0,\s*0\.8\)/u);
    assert.match(timeDisplay, /text-shadow:\s*1px\s+1px\s+0\s+var\(--accent-color/u);
    assert.match(timeDisplay, /text-shadow:\s*1px\s+1px\s+0\s+color-mix\(in\s+srgb\s*,\s*var\(--accent-color/u);
    assert.doesNotMatch(timeDisplay, /-webkit-text-stroke/u);
    assert.match(fileNameDisplay, /color:\s*rgba\(255,\s*255,\s*255,\s*0\.8\)/u);
    assert.match(fileNameDisplay, /2px\s+2px\s+8px\s+rgba\(0,\s*0,\s*0,\s*0\.8\)/u);
    assert.match(fileNameDisplay, /text-shadow:\s*1px\s+1px\s+0\s+var\(--accent-color/u);
    assert.match(fileNameDisplay, /text-shadow:\s*1px\s+1px\s+0\s+color-mix\(in\s+srgb\s*,\s*var\(--accent-color/u);
    assert.doesNotMatch(fileNameDisplay, /-webkit-text-stroke/u);
    assert.match(themeCss, /--accent-color:\s*#00d2ff/u);
    assert.match(displayCss, /#waitingMessage h2[\s\S]*color:\s*var\(--text-primary(?:,\s*[^)]+)?\)/u);
    assert.match(displayCss, /\.voice-response-popup[\s\S]*background:\s*var\(--bg-secondary(?:,\s*[^)]+)?\)/u);
    assert.match(displayCss, /\.voice-response-content[\s\S]*color:\s*var\(--text-primary(?:,\s*[^)]+)?\)/u);
    assert.match(displayCss, /\.connected[\s\S]*background:\s*var\(--bg-secondary(?:,\s*[^)]+)?\)/u);
    assert.doesNotMatch(displayCss, /#mediaImage\s*\{[^}]*filter:/u);
    assert.doesNotMatch(displayCss, /#mediaVideo\s*\{[^}]*filter:/u);
    assert.doesNotMatch(displayCss, /#mediaHtml\s*\{[^}]*filter:/u);
});
