'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const readPublicFile = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

test('控制页面同时提供主面板和浮动面板的文本模式设置与翻页操作', () => {
    const html = readPublicFile('upload.html');

    assert.match(html, /文本模式/u);
    assert.match(html, /textModeSettingsBtn/u);
    assert.match(html, /textPlaybackPrevBtn/u);
    assert.match(html, /textPlaybackNextBtn/u);
    assert.match(html, /textPlaybackStopBtn/u);
    assert.match(html, /floatingTextPlaybackPrevBtn/u);
    assert.match(html, /floatingTextPlaybackNextBtn/u);
    assert.match(html, /floatingTextPlaybackStopBtn/u);
});

test('浮动文本模式入口复用主面板的完整 textStyle 设置协议', () => {
    const html = readPublicFile('upload.html');
    const floating = readPublicFile('js/floating-control.js');

    assert.match(html, /floatingTextModeSettingsBtn/u);
    assert.match(html, /FloatingControl\.showTextModePanel\(\)/u);
    assert.match(floating, /showTextModePanel\(\)\s*\{[\s\S]*?window\.Controls\.showTextModePanel\(\)/u);
});

test('文本模式默认黄底深灰字并向当前显示端发送完整 textStyle', () => {
    const controls = readPublicFile('js/controls.js');

    assert.match(controls, /showTextModePanel\(\)/u);
    assert.match(controls, /#FFF4B8/u);
    assert.match(controls, /#333333/u);
    assert.match(controls, /fontSize/u);
    assert.match(controls, /lineHeight/u);
    assert.match(controls, /pageMargin/u);
    assert.match(controls, /sendControl\('textStyle', textStyle\)/u);
});

test('文本翻页和播放操作使用 textPlayback 协议，不复用播放列表前后项', () => {
    const controls = readPublicFile('js/controls.js');
    const floating = readPublicFile('js/floating-control.js');

    assert.match(controls, /sendTextPlayback\(action\)/u);
    assert.match(controls, /sendControl\('textPlayback', \{ action \}\)/u);
    assert.match(floating, /sendTextPlayback\(action\)/u);
    assert.match(floating, /sendControl\('textPlayback', \{ action \}\)/u);
    assert.doesNotMatch(controls.match(/sendTextPlayback\(action\)[\s\S]*?\n    \}/u)?.[0] || '', /controlPlaylist/u);
});

test('文本进度只更新当前显示端的主面板和浮动面板状态', () => {
    const websocket = readPublicFile('js/websocket.js');
    const controls = readPublicFile('js/controls.js');
    const floating = readPublicFile('js/floating-control.js');

    assert.match(websocket, /data\.type === 'textProgress'/u);
    assert.match(websocket, /data\.displayId !== window\.currentDisplayId\) return;/u);
    assert.match(websocket, /Controls\.updateTextPlaybackStatus\(data\)/u);
    assert.match(websocket, /FloatingControl\.updateTextPlaybackStatus\(data\)/u);
    assert.match(controls, /updateTextPlaybackStatus\(progress\)/u);
    assert.match(floating, /updateTextPlaybackStatus\(progress\)/u);
});
