'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

test('弹幕画布和开关随四方向旋转，滚动可完整离开画布', { timeout: 30000 }, async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setViewport({ width: 600, height: 400 });
    const root = path.resolve('src/apps/web-mediacenter/ui/public');
    const css = fs.readFileSync(path.join(root, 'css/display.css'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'display.html'), 'utf8');
    assert.match(html, /danmakuHost\.dataset\.rotation = String\(currentRotation\)/u);
    await page.setContent(`<style>${css}</style><div id="mediaContainer"><div id="bilibiliDanmakuLayerHost"><button id="danmakuToggle">弹幕</button><div class="bilibili-danmaku-layer"><span class="bilibili-danmaku scroll">一条很长很长的滚动弹幕</span></div></div></div>`);
    for (const angle of [0, 90, 180, 270]) {
        const result = await page.evaluate(value => {
            const host = document.getElementById('bilibiliDanmakuLayerHost');
            host.dataset.rotation = value;
            host.style.setProperty('--danmaku-width', `${value % 180 ? innerHeight : innerWidth}px`);
            const span = host.querySelector('.scroll');
            const animation = span.getAnimations()[0]; animation.pause(); animation.currentTime = 8999;
            const bounds = host.getBoundingClientRect();
            const button = document.getElementById('danmakuToggle').getBoundingClientRect();
            return { width: bounds.width, height: bounds.height, button: { left: button.left, right: button.right, top: button.top, bottom: button.bottom },
                offset: new DOMMatrix(getComputedStyle(span).transform).m41, logicalWidth: host.clientWidth, textWidth: span.offsetWidth };
        }, angle);
        assert.ok(Math.abs(result.width - 600) < 1 && Math.abs(result.height - 400) < 1, `画布 ${angle}° 覆盖视口`);
        assert.ok(result.button.left >= 0 && result.button.right <= 600 && result.button.top >= 0 && result.button.bottom <= 400);
        assert.ok(result.offset < -result.logicalWidth - result.textWidth + 1, `滚动 ${angle}° 完整离开`);
    }
});
