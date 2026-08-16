'use strict';
// 集成测试：控制端切换角度，fit 非 crop 模式不应误发 crop 消息
// （否则显示端收到 crop 会把 currentFit 强制切成裁剪放大——bug 复现链路）
// 场景：
//   A. contain + 非控制模式 + 切 90° → 不应发送 'crop'
//   B. crop   + 非控制模式 + 切 90° → 应发送 'crop'（保持既有裁剪行为）
//   C. crop   + 控制模式   + 切 90° → 不应发送 'crop'（控制模式已屏蔽）
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('../node_modules/express');
const puppeteer = require('../node_modules/puppeteer');
const { once } = require('node:events');

const PUBLIC = require('node:path').resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const EXECUTABLE = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

const TEST_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>crop.js 控制端测试页</title>
<style>
    #cropPreviewContainer { width:400px; height:400px; position:relative; overflow:hidden;
        display:flex; align-items:center; justify-content:center; }
    #cropPreviewImg, #cropPreviewVideo { max-width:100%; max-height:100%; object-fit:contain; display:none; }
    #cropPreviewPlaceholder { display:none; position:absolute; }
    #cropBox { display:none; position:absolute; }
</style>
</head>
<body>
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
</body>
</html>`;

let server;
let browser;

before(async () => {
    const app = express();
    app.use(express.static(PUBLIC));
    app.get('/crop-test', (req, res) => res.type('html').send(TEST_PAGE));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    browser = await puppeteer.launch({
        executablePath: EXECUTABLE,
        headless: true,
        protocolTimeout: 60000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu']
    });
});

after(async () => {
    if (browser) await browser.close();
    if (server) server.close();
});

async function loadAndRun() {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/crop-test`, { waitUntil: 'load', timeout: 20000 });
    await new Promise(r => setTimeout(r, 500));

    const result = await page.evaluate(async () => {
        const calls = [];
        window.WebSocketManager = { sendControl: (action, value) => calls.push({ action, value }) };

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

        const wait = () => new Promise(r => setTimeout(r, 450)); // 等 applyRotation 的 350ms 延迟

        const run = async (currentFit, controlModeOn) => {
            calls.length = 0;
            window.Crop.currentFit = currentFit;
            window.Crop.controlModeOn = controlModeOn;
            window.Crop.applyRotation(90);
            await wait();
            return calls.some(c => c.action === 'crop');
        };

        return {
            aSendsCrop: await run('contain', false),
            bSendsCrop: await run('crop', false),
            cSendsCrop: await run('crop', true)
        };
    });

    await page.close();
    return { result, pageErrors };
}

test('contain 非控制模式切角度不发 crop（显示端保持适配模式）', async () => {
    const { result, pageErrors } = await loadAndRun();
    assert.strictEqual(pageErrors.length, 0, `页面 JS 错误: ${pageErrors.join('; ')}`);
    assert.strictEqual(result.aSendsCrop, false, 'contain 模式切角度不应发 crop');
});

test('crop 模式切角度仍发 crop（既有裁剪行为保留）', async () => {
    const { result } = await loadAndRun();
    assert.strictEqual(result.bSendsCrop, true, 'crop 模式切角度应发 crop');
});

test('控制模式切角度不发 crop（已有屏蔽不回归）', async () => {
    const { result } = await loadAndRun();
    assert.strictEqual(result.cSendsCrop, false, '控制模式切角度不应发 crop');
});
