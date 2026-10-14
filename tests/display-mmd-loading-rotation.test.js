'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('../node_modules/cheerio');
const puppeteer = require('../node_modules/puppeteer');

const PUBLIC = require('node:path').resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const readPublic = (relativePath) => fs.readFileSync(path.join(PUBLIC, relativePath), 'utf8');

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
        new Promise((resolve) => setTimeout(() => resolve(false), 5000))
    ]);
    if (!closed) browser.process()?.kill();
});

test('PMX 加载进度条在竖屏和横屏四向旋转时保持可见、完整且文字随舞台旋转', {
    timeout: 30000
}, async () => {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 360, height: 800 }]) {
        const page = await browser.newPage();
        try {
            await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
            const $ = cheerio.load(readPublic('display.html'));
            $('script, link[rel="stylesheet"]').remove();
            $('head').append(`<style>${readPublic('css/theme.css')}${readPublic('css/display.css')}${readPublic('css/display-mmd.css')}</style>`);
            await page.setContent($.html());
            await page.addScriptTag({ path: path.join(PUBLIC, 'js/display-stage.js') });
            await page.waitForFunction(() => window.DisplayStage?.getState?.().initialized === true, { timeout: 10000 });
            const results = await page.evaluate(async () => {
                const layer = document.getElementById('displayMmdLoadingLayer');
                const progress = document.getElementById('displayMmdLoadingProgress');
                const text = document.getElementById('displayMmdLoadingText');
                const fill = document.getElementById('displayMmdLoadingFill');
                progress.hidden = false;
                layer.setAttribute('aria-hidden', 'false');
                progress.setAttribute('aria-valuenow', '42');
                text.textContent = 'PMX 模型加载 42%';
                fill.style.width = '42%';

                const measurements = {};
                for (const rotation of [0, 90, 180, 270]) {
                    window.currentRotation = rotation;
                    window.DisplayStage.setRotation(rotation);
                    // 样式赋值同步，下一次任务完成后读取布局，避免后台/低帧率Chromium暂停RAF。
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    const rect = progress.getBoundingClientRect();
                    const transform = new DOMMatrixReadOnly(getComputedStyle(layer).transform);
                    measurements[rotation] = {
                        left: rect.left,
                        right: rect.right,
                        top: rect.top,
                        bottom: rect.bottom,
                        width: rect.width,
                        height: rect.height,
                        angle: (Math.round(Math.atan2(transform.b, transform.a) * 180 / Math.PI) + 360) % 360,
                        value: progress.getAttribute('aria-valuenow'),
                        fillWidth: fill.style.width,
                        hidden: progress.hidden,
                        ariaHidden: layer.getAttribute('aria-hidden'),
                        viewportWidth: window.innerWidth,
                        viewportHeight: window.innerHeight
                    };
                }
                return measurements;
            });

            for (const rotation of [0, 90, 180, 270]) {
                const result = results[rotation];
                const details = `${viewport.width}x${viewport.height}, ${rotation}°: ${JSON.stringify(result)}`;
                assert.equal(result.angle, rotation, `进度条内容方向应跟随显示端旋转；${details}`);
                assert.equal(result.value, '42', `进度值应保留；${details}`);
                assert.equal(result.fillWidth, '42%', `进度填充应保留；${details}`);
                assert.equal(result.hidden, false, `加载期间进度条应可见；${details}`);
                assert.ok(result.width > 0 && result.height > 0, `进度条应有可见尺寸；${details}`);
                assert.ok(result.left >= -1, `进度条左侧不能越界；${details}`);
                assert.ok(result.right <= result.viewportWidth + 1, `进度条右侧不能越界；${details}`);
                assert.ok(result.top >= -1, `进度条顶部不能越界；${details}`);
                assert.ok(result.bottom <= result.viewportHeight + 1, `进度条底部不能越界；${details}`);
            }
        } finally {
            await page.close();
        }
    }
});
