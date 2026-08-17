'use strict';
// 快速验证：裁剪框拖拽路径 sendData() 在非裁剪模式下自动切为裁剪模式（发 fit='crop'）
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('../node_modules/express');
const puppeteer = require('../node_modules/puppeteer');
const { once } = require('node:events');

const PUBLIC = require('node:path').resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const EXECUTABLE = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

const TEST_PAGE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>crop sendData 验证</title>
<style>
    #cropPreviewContainer { width:400px; height:400px; position:relative; overflow:hidden;
        display:flex; align-items:center; justify-content:center; }
    #cropPreviewImg, #cropPreviewVideo { max-width:100%; max-height:100%; object-fit:contain; display:none; }
    #cropPreviewPlaceholder { display:none; position:absolute; }
    #cropBox { display:none; position:absolute; }
</style></head><body>
    <div id="cropPreviewContainer">
        <img id="cropPreviewImg"><video id="cropPreviewVideo"></video>
        <div id="cropPreviewPlaceholder"></div><div id="cropBox"></div>
    </div>
    <input id="cropInputX"><input id="cropInputY"><input id="cropInputWidth"><input id="cropInputHeight">
    <input id="customWidth"><input id="customHeight"><input id="customLeft"><input id="customTop">
    <button id="centerResizeBtn"></button>
    <input type="checkbox" id="controlModeToggle">
    <button id="controlTextSendBtn"></button><input id="controlTextInput">
    <div id="controlTextRow" style="display:none"></div>
    <button id="refreshDisplayBtn"></button>
    <span id="controlCapabilityHint"></span>
    <script src="/js/control-mode-utils.js"></script>
    <script src="/js/crop.js"></script>
</body></html>`;

let server, browser;
before(async () => {
    const app = express();
    app.use(express.static(PUBLIC));
    app.get('/crop-sync-test', (req, res) => res.type('html').send(TEST_PAGE));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    browser = await puppeteer.launch({
        executablePath: EXECUTABLE, headless: true, protocolTimeout: 60000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu']
    });
});
after(async () => { if (browser) await browser.close(); if (server) server.close(); });

test('非裁剪模式 sendData 自动切裁剪（发 fit=crop + crop，currentFit 变 crop）', async () => {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/crop-sync-test`, { waitUntil: 'load', timeout: 20000 });
    await new Promise(r => setTimeout(r, 300));
    const r = await page.evaluate(async () => {
        const calls = [];
        window.WebSocketManager = { sendControl: (action, value) => calls.push({ action, value }) };
        // 模拟真实 upload.html 的 Controls.sendFitMode（控制端按钮高亮 + currentFit + 发 fit/crop）
        window.Controls = {
            sendFitMode(fit) {
                window.Crop.currentFit = fit;
                window.WebSocketManager.sendControl('fit', fit);
                window.WebSocketManager.sendControl('crop', window.Crop.data);
            }
        };
        const canvas = document.createElement('canvas');
        canvas.width = 1920; canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#2266cc'; ctx.fillRect(0, 0, 1920, 1080);
        const img = document.getElementById('cropPreviewImg');
        img.src = canvas.toDataURL('image/png');
        img.style.display = 'block';
        await new Promise(res => { img.onload = () => res(); });
        await new Promise(r => setTimeout(r, 50));
        window.displayCanvasSize = { width: 1920, height: 1080 };
        window.Crop.initControlMode();

        // 场景1：contain 模式，拖拽路径调用 sendData → 应发 fit='crop' + crop，currentFit→crop
        calls.length = 0;
        window.Crop.currentFit = 'contain';
        window.Crop.sendData();
        const first = { actions: calls.map(c => c.action), fit: window.Crop.currentFit };

        // 场景2：已是 crop 模式，再次 sendData → 只发 crop，不发 fit
        calls.length = 0;
        window.Crop.sendData();
        const second = { actions: calls.map(c => c.action) };

        // 场景3：重置裁剪（reset 内部 sendData），从 contain 开始 → 发 fit='crop' + crop
        calls.length = 0;
        window.Crop.currentFit = 'contain';
        window.Crop.data = { x: 10, y: 10, width: 40, height: 40 };
        window.Crop.box.style.display = 'block';
        window.Crop.reset();
        const third = { actions: calls.map(c => c.action), fit: window.Crop.currentFit };

        return { first, second, third };
    });
    await page.close();
    assert.strictEqual(pageErrors.length, 0, `页面 JS 错误: ${pageErrors.join('; ')}`);
    // 场景1：contain → 自动切裁剪，发 fit + crop，currentFit 变 crop
    assert.deepStrictEqual(r.first.actions, ['fit', 'crop'], `场景1 应发 fit+crop，实际 ${JSON.stringify(r.first.actions)}`);
    assert.strictEqual(r.first.fit, 'crop', '场景1 currentFit 应变 crop');
    // 场景2：已是 crop → 只发 crop，不再重复发 fit
    assert.deepStrictEqual(r.second.actions, ['crop'], `场景2 应只发 crop，实际 ${JSON.stringify(r.second.actions)}`);
    // 场景3：重置裁剪（reset）从 contain 自动切裁剪
    assert.deepStrictEqual(r.third.actions, ['fit', 'crop'], `场景3 应发 fit+crop，实际 ${JSON.stringify(r.third.actions)}`);
    assert.strictEqual(r.third.fit, 'crop', '场景3 currentFit 应变 crop');
});
