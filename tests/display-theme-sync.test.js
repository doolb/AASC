'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '../src/apps/web-mediacenter/ui/public');
const display = fs.readFileSync(path.join(root, 'display.html'), 'utf8');
const displayCss = fs.readFileSync(path.join(root, 'css/display.css'), 'utf8');
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

test('显示端 UI 应使用共享主题变量且不覆盖媒体内容', () => {
    assert.match(displayCss, /html, body[\s\S]*background:\s*var\(--bg-primary(?:,\s*[^)]+)?\)/u);
    assert.match(displayCss, /#mediaText[\s\S]*background:\s*var\(--bg-secondary(?:,\s*[^)]+)?\)/u);
    assert.match(displayCss, /#mediaText[\s\S]*color:\s*var\(--text-primary(?:,\s*[^)]+)?\)/u);
    assert.match(displayCss, /#waitingMessage h2[\s\S]*color:\s*var\(--text-primary(?:,\s*[^)]+)?\)/u);
    assert.match(displayCss, /\.voice-response-popup[\s\S]*background:\s*var\(--bg-secondary(?:,\s*[^)]+)?\)/u);
    assert.match(displayCss, /\.voice-response-content[\s\S]*color:\s*var\(--text-primary(?:,\s*[^)]+)?\)/u);
    assert.match(displayCss, /\.connected[\s\S]*background:\s*var\(--bg-secondary(?:,\s*[^)]+)?\)/u);
    assert.doesNotMatch(displayCss, /#mediaImage\s*\{[^}]*filter:/u);
    assert.doesNotMatch(displayCss, /#mediaVideo\s*\{[^}]*filter:/u);
    assert.doesNotMatch(displayCss, /#mediaHtml\s*\{[^}]*filter:/u);
});
