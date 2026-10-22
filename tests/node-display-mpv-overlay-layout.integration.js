'use strict';

// 真实网页作为布局判据：只在本机临时静态服务器与独立浏览器中执行，不连接用户服务。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const puppeteer = require('puppeteer');
const { overlayLayout, physicalPoint } = require('../src/apps/voice-display-node/mpv-overlay');
const { THEMES, paletteFor, colorValue } = require('../src/apps/voice-display-node/mpv-appearance');

function physicalRect(layout, box) {
    const points = [[box.x, box.y], [box.x + box.width, box.y + box.height]].map(([x, y]) => physicalPoint(layout, x, y));
    return { left: Math.min(...points.map(point => point[0])), right: Math.max(...points.map(point => point[0])),
        top: Math.min(...points.map(point => point[1])), bottom: Math.max(...points.map(point => point[1])) };
}

test('ASS位置对照真实网页：时间/连接四角，TTS最终顶部锚点，ASR按钮上方，横竖窗口四旋转', { timeout: 60000 }, async t => {
    const app = express();
    app.use(express.static(path.resolve('src/apps/web-mediacenter/ui/public')));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-mpv-layout-'));
    t.after(() => fs.rm(profile, { recursive: true, force: true }));
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        userDataDir: profile, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=user-gesture-required'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (request.url().startsWith(`http://127.0.0.1:${server.address().port}/`) || request.url().startsWith('data:')) void request.continue();
        else void request.abort();
    });
    const samples = [];
    for (const [width, height] of [[800, 600], [600, 800]]) {
        await page.setViewport({ width, height });
        await page.goto(`http://127.0.0.1:${server.address().port}/display.html?displayId=mpv-layout-test`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.handleControl === 'function' && window.DisplayStage?.getState().initialized);
        for (const rotation of [0, 90, 180, 270]) {
            const actual = await page.evaluate(async angle => {
                const element = document.getElementById('voiceTextDisplay');
                document.body.classList.remove('display-chat-open');
                element.dataset.voiceTextMode = 'tts';
                element.innerHTML = '<div class="tts-subtitle-viewport"><div class="tts-subtitle-content"><div class="tts-subtitle-line">TTS当前播放</div></div></div>';
                element.className = 'voice-text-visible';
                updateAsrResultDisplay('ASR最新识别');
                handleControl({ action: 'rotate', value: angle });
                for (let frame = 0; frame < 4; frame += 1) await new Promise(resolve => requestAnimationFrame(resolve));
                const rect = id => {
                    const node = document.getElementById(id);
                    const box = node.getBoundingClientRect();
                    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
                        width: box.width, height: box.height, fontSize: Number.parseFloat(getComputedStyle(node).fontSize) };
                };
                return { tts: rect('voiceTextDisplay'), asr: rect('displayVoiceAsrResult'),
                    clock: rect('timeDisplay'), connection: rect('connectionStatus') };
            }, rotation);
            const layout = overlayLayout({ width, height, rotation, tts: 'TTS当前播放', asr: 'ASR最新识别' });
            const tts = physicalRect(layout, layout.tts);
            for (const key of ['left', 'right', 'top', 'bottom']) {
                assert.ok(Math.abs(actual.tts[key] - tts[key]) < 2, `TTS ${width}x${height}/${rotation} ${key}: 网页${actual.tts[key]}，ASS${tts[key]}`);
            }
            // ASR宽度受平台字体度量影响，对照底部中心锚点，保留网页按钮和状态行占位。
            const anchor = physicalPoint(layout, layout.layoutWidth / 2, layout.asr.y + layout.asr.height);
            const actualAnchor = { 0: [(actual.asr.left + actual.asr.right) / 2, actual.asr.bottom],
                90: [actual.asr.left, (actual.asr.top + actual.asr.bottom) / 2],
                180: [(actual.asr.left + actual.asr.right) / 2, actual.asr.top],
                270: [actual.asr.right, (actual.asr.top + actual.asr.bottom) / 2] }[rotation];
            assert.ok(anchor.every((value, index) => Math.abs(value - actualAnchor[index]) < 3),
                `ASR ${width}x${height}/${rotation} 网页${actualAnchor}，ASS${anchor}`);
            const corner = physicalPoint(layout, layout.clock.x, layout.clock.y);
            const clockAnchor = { 0: [actual.clock.right, actual.clock.top], 90: [actual.clock.right, actual.clock.bottom],
                180: [actual.clock.left, actual.clock.bottom], 270: [actual.clock.left, actual.clock.top] }[rotation];
            assert.ok(corner.every((value, index) => Math.abs(value - clockAnchor[index]) < 2), `clock ${rotation}: ${clockAnchor} / ${corner}`);
            assert.equal(actual.clock.fontSize, layout.clock.fontSize);
            assert.equal(actual.connection.fontSize, layout.connection.fontSize);
            const connectionCorner = physicalPoint(layout, 20, 20);
            const connectionAnchor = { 0: [actual.connection.left, actual.connection.top], 90: [actual.connection.right, actual.connection.top],
                180: [actual.connection.right, actual.connection.bottom], 270: [actual.connection.left, actual.connection.bottom] }[rotation];
            assert.ok(connectionCorner.every((value, index) => Math.abs(value - connectionAnchor[index]) < 2),
                `connection ${rotation}: ${connectionAnchor} / ${connectionCorner}`);
            samples.push({ width, height, rotation, tts, asrAnchor: anchor, clockAnchor: corner });
        }
    }
    // 直接读取浏览器最终计算样式，验证独立包内调色板没有偏离网页主题定义。
    const cssColor = color => {
        const value = colorValue(color);
        const rgb = value.color.slice(1).match(/../g).map(channel => Number.parseInt(channel, 16)).join(', ');
        return value.opacity === 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${value.opacity})`;
    };
    for (const theme of THEMES) {
        const actual = await page.evaluate(themeName => {
            window.UiTheme.applyRemoteTheme(themeName);
            const element = document.getElementById('voiceTextDisplay');
            const connection = document.getElementById('connectionStatus');
            connection.style.transition = 'none';
            const read = node => {
                const style = getComputedStyle(node);
                return { color: style.color, background: style.backgroundColor, shadow: style.textShadow,
                    stroke: style.webkitTextStrokeColor, strokeWidth: style.webkitTextStrokeWidth,
                    borderRadius: style.borderRadius, backgroundImage: style.backgroundImage };
            };
            element.dataset.voiceTextMode = 'tts'; const tts = read(element);
            element.dataset.voiceTextMode = 'asr'; const asr = read(element);
            const states = {};
            for (const state of ['connected', 'disconnected', 'connecting']) { connection.className = state; states[state] = read(connection); }
            const root = getComputedStyle(document.documentElement);
            return { tts, asr, states, clock: read(document.getElementById('timeDisplay')),
                footer: read(document.getElementById('mediaTextStatus')),
                shadowColor: root.getPropertyValue('--shadow-color').trim() };
        }, theme);
        const palette = paletteFor(theme);
        assert.equal(actual.asr.color, cssColor(palette.primary.color), theme);
        assert.equal(actual.asr.background, cssColor(palette.background.color), theme);
        assert.deepEqual(colorValue(actual.shadowColor), palette.shadow, theme);
        assert.equal(actual.footer.color, cssColor(palette.secondary.color), theme);
        assert.equal(actual.states.connected.color, cssColor(palette.success.color), theme);
        assert.equal(actual.states.disconnected.color, cssColor(palette.danger.color), theme);
        assert.equal(actual.states.connecting.color, cssColor(palette.accent.color), theme);
        assert.equal(actual.clock.color, 'rgba(255, 255, 255, 0.9)', theme);
        assert.equal(actual.tts.color, actual.clock.color, theme);
        assert.equal(actual.tts.stroke, cssColor(palette.accent.color), theme);
        assert.equal(actual.tts.strokeWidth, '0.5px', theme);
        assert.equal(actual.tts.shadow, actual.clock.shadow, theme);
        assert.match(actual.clock.shadow, /0px 2px 0px/); assert.match(actual.clock.shadow, /2px 2px 8px/);
        assert.match(actual.asr.shadow, /1px 1px 4px/);
        assert.match(actual.tts.backgroundImage, /18%/); assert.match(actual.tts.backgroundImage, /82%/);
        assert.equal(actual.asr.borderRadius, '12px'); assert.equal(actual.states.connected.borderRadius, '20px');
    }
    t.diagnostic(`已对照${THEMES.length}套主题的实际文字/背景/状态/描边/阴影样式`);
    t.diagnostic(JSON.stringify(samples));
});
