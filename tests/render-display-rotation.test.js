'use strict';

// render-display 旋转回归测试：覆盖层必须避开媒体名，并保持 0° 时“覆盖层在媒体名上侧”的视觉层级。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('../node_modules/express');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('../node_modules/puppeteer');
const { once } = require('node:events');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const RENDER_DIR = path.resolve(__dirname, '../res/tasks/render-display');
const RENDER_FILES = ['render.html', 'render.js'].map((name) => ({
    name,
    data: fs.readFileSync(path.join(RENDER_DIR, name)).toString('base64')
}));

let server;
let browser;

before(async () => {
    const app = express();
    app.use(express.static(PUBLIC));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu']
    });
});

after(async () => {
    if (browser) await browser.close();
    if (server) server.close();
});

test('render-display旋转后保持覆盖层与媒体名的相对位置', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(`http://127.0.0.1:${server.address().port}/display.html?displayId=render-rotation-test`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000
    });
    await page.waitForFunction(() => typeof window.handleControl === 'function', { timeout: 10000 });

    const positions = await page.evaluate(async (renderFiles) => {
        executeRenderTask({
            files: renderFiles,
            params: {},
            taskName: 'render-display',
            instanceId: 'rotation-test'
        });
        const update = window._renderTaskUpdates['rotation-test'];
        const fileName = document.getElementById('fileNameDisplay');
        fileName.textContent = '媒体中文名称测试';
        fileName.style.display = 'block';
        const source = {
            hostname: '测试设备',
            cpuPercent: 50,
            memPercent: 30,
            memUsed: 3,
            memTotal: 8
        };
        const results = {};
        for (const angle of [0, 90, 180, 270]) {
            handleControl({ action: 'rotate', value: angle });
            update(source);
            await new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            });
            const overlay = document.getElementById('monitorOverlay');
            const overlayRect = overlay.getBoundingClientRect();
            const fileRect = fileName.getBoundingClientRect();
            results[angle] = {
                overlay: {
                    left: overlayRect.left,
                    right: overlayRect.right,
                    top: overlayRect.top,
                    bottom: overlayRect.bottom
                },
                fileName: {
                    left: fileRect.left,
                    right: fileRect.right,
                    top: fileRect.top,
                    bottom: fileRect.bottom
                }
            };
        }
        return results;
    }, RENDER_FILES);

    const gap = 24;
    assert.ok(
        positions[0].overlay.bottom <= positions[0].fileName.top - gap,
        `0°覆盖层应位于媒体名上侧: ${JSON.stringify(positions[0])}`
    );
    assert.ok(
        positions[90].overlay.left >= positions[90].fileName.right + gap,
        `90°覆盖层应位于媒体名右侧: ${JSON.stringify(positions[90])}`
    );
    assert.ok(
        positions[180].overlay.top >= positions[180].fileName.bottom + gap,
        `180°覆盖层应位于媒体名下侧: ${JSON.stringify(positions[180])}`
    );
    assert.ok(
        positions[270].overlay.right <= positions[270].fileName.left - gap,
        `270°覆盖层应位于媒体名左侧: ${JSON.stringify(positions[270])}`
    );
    for (const angle of [90, 180, 270]) {
        const box = positions[angle].overlay;
        assert.ok(box.left >= 0 && box.right <= 1920, `${angle}°覆盖层横向越界: ${JSON.stringify(box)}`);
        assert.ok(box.top >= 0 && box.bottom <= 1080, `${angle}°覆盖层纵向越界: ${JSON.stringify(box)}`);
    }
    await page.close();
});

test('render-display按DPR反向缩放并将旋转包围盒限制在视口内', async () => {
    const page = await browser.newPage();
    const viewport = { width: 1920, height: 1080 };
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${server.address().port}/display.html?displayId=render-dpr-test`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000
    });
    await page.waitForFunction(() => typeof window.handleControl === 'function', { timeout: 10000 });

    const renderFiles = RENDER_FILES;
    const measure = async (deviceScaleFactor, size = viewport) => {
        await page.setViewport({ ...size, deviceScaleFactor });
        return page.evaluate(async (files) => {
            if (!window._renderTaskUpdates?.['dpr-test']) {
                executeRenderTask({
                    files,
                    params: {},
                    taskName: 'render-display',
                    instanceId: 'dpr-test'
                });
            }
            const update = window._renderTaskUpdates['dpr-test'];
            const source = { hostname: 'DPR设备', cpuPercent: 45, memPercent: 55, memUsed: 4, memTotal: 8 };
            const results = {};
            for (const angle of [0, 90, 180, 270]) {
                handleControl({ action: 'rotate', value: angle });
                update(source);
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const rect = document.getElementById('monitorOverlay').getBoundingClientRect();
                results[angle] = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
            }
            return { dpr: window.devicePixelRatio, results };
        }, renderFiles);
    };

    const normal = await measure(1);
    const highDpi = await measure(2);
    const compactViewport = await measure(1, { width: 800, height: 500 });
    assert.equal(normal.dpr, 1);
    assert.equal(highDpi.dpr, 2);
    assert.ok(
        highDpi.results[0].width <= normal.results[0].width * 0.55,
        `DPR 2 下覆盖层应近似缩小一半: ${JSON.stringify({ normal: normal.results[0], highDpi: highDpi.results[0] })}`
    );
    for (const angle of [0, 90, 180, 270]) {
        const rect = highDpi.results[angle];
        assert.ok(rect.left >= -1 && rect.right <= viewport.width + 1, `${angle}°横向越界: ${JSON.stringify(rect)}`);
        assert.ok(rect.top >= -1 && rect.bottom <= viewport.height + 1, `${angle}°纵向越界: ${JSON.stringify(rect)}`);
        const compactRect = compactViewport.results[angle];
        assert.ok(compactRect.left >= -1 && compactRect.right <= 801, `${angle}°窄视口横向越界: ${JSON.stringify(compactRect)}`);
        assert.ok(compactRect.top >= -1 && compactRect.bottom <= 501, `${angle}°窄视口纵向越界: ${JSON.stringify(compactRect)}`);
    }
    await page.close();
});
