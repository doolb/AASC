'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const WebSocket = require('ws');
const puppeteer = require('puppeteer');
const path = require('node:path');

test('真实显示页视频按有效画面适应/铺满/旋转/动态，切源与关闭清理检测', { timeout: 25000 }, async t => {
    const app = express();
    app.get('/fps-harness.html', (_request, response) => response.type('html').send('<!doctype html><video id="probeVideo" muted playsinline></video>'));
    app.use(express.static(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public')));
    const server = http.createServer(app), wss = new WebSocket.Server({ server });
    const corsRequests = [];
    let videoBytes;
    const videoServer = http.createServer((request, response) => {
        corsRequests.push(request.headers.origin || null);
        response.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': videoBytes.length, 'Cache-Control': 'no-store' });
        response.end(videoBytes);
    });
    let socket;
    wss.on('connection', ws => {
        socket = ws;
        ws.send(JSON.stringify({ type: 'restoreState', state: { autoBlackBorders: true, fit: 'contain', sleep: { enabled: false } } }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await new Promise(resolve => videoServer.listen(0, '127.0.0.1', resolve));
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    t.after(async () => {
        await browser.close(); for (const client of wss.clients) client.terminate();
        await new Promise(resolve => wss.close(resolve));
        server.closeAllConnections(); videoServer.closeAllConnections();
        await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => videoServer.close(resolve))]);
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    t.after(() => { if (pageErrors.length) t.diagnostic(JSON.stringify({ pageErrors })); });
    await page.setViewport({ width: 800, height: 600 });
    await page.goto(`http://127.0.0.1:${server.address().port}/display.html?displayId=black-border-isolated`, { waitUntil: 'load' });
    await page.waitForFunction(() => displayWs?.readyState === 1);
    await page.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext('2d'); let count = 0;
        const previousChange = videoBlackBorders.onChange;
        videoBlackBorders.onChange = (...args) => {
            previousChange(...args);
            if (args[1]) window.testBorderTransition = mediaVideo.style.transition;
        };
        document.getElementById('mediaContainer').style.background = 'rgb(60, 40, 90)';
        const paint = () => {
            context.fillStyle = 'black'; context.fillRect(0, 0, 320, 180);
            const r = window.testRegion || [20, 24, 280, 132];
            context.fillStyle = '#25b4dd'; context.fillRect(...r);
            context.fillStyle = count++ % 2 ? '#eee' : '#ccc'; context.fillRect(140, 70, 8, 8);
        };
        paint(); window.testPaint = setInterval(paint, 100);
        window.testStream = canvas.captureStream(10);
        currentMediaType = 'video'; mediaImage.style.display = 'none'; mediaVideo.style.display = 'block';
        videoBlackBorders.setActive(true); mediaVideo.srcObject = window.testStream;
        mediaVideo.muted = true; await mediaVideo.play(); applyFit('contain');
    });
    await page.waitForFunction(() => VideoBlackBorders.hasBorder(videoBlackBorders.tracker.rect), { timeout: 9000 });
    assert.match(await page.evaluate(() => window.testBorderTransition), /width 200ms/);
    await page.waitForFunction(() => blackBorderTransitionTimer === null);
    const initial = await page.evaluate(() => ({ rect: videoBlackBorders.tracker.rect, width: parseFloat(mediaVideo.style.width),
        height: parseFloat(mediaVideo.style.height), clip: mediaVideo.style.clipPath }));
    assert.ok(initial.rect.x > 0.04 && initial.rect.y > 0.1);
    assert.ok(initial.width < 950 && initial.height < 600); assert.match(initial.clip, /^inset/);
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const padding = await page.evaluate(async screenshot => {
        const image = new Image(); image.src = 'data:image/png;base64,' + screenshot; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(400, 90, 1, 1).data);
    }, screenshot);
    assert.deepEqual(padding, [60, 40, 90, 255], '适应模式的留白显示画布背景，不残留文件内黑边');
    for (const rotation of [0, 90, 180, 270]) {
        const sizes = await page.evaluate(rotation => {
            currentRotation = rotation; applyRotation(); applyFit('contain');
            const contain = [parseFloat(mediaVideo.style.width), parseFloat(mediaVideo.style.height)];
            applyFit('cover');
            return { contain, cover: [parseFloat(mediaVideo.style.width), parseFloat(mediaVideo.style.height)] };
        }, rotation);
        assert.ok(sizes.cover[0] >= sizes.contain[0] && sizes.cover[1] >= sizes.contain[1]);
    }
    await page.evaluate(() => { currentRotation = 0; applyRotation(); setDynamicFitConfig({ holdSeconds: 0.1, transitionSeconds: 0.5 }); applyFit('dynamic'); });
    await new Promise(resolve => setTimeout(resolve, 350));
    const dynamic = await page.evaluate(() => ({ width: mediaVideo.getBoundingClientRect().width, transition: mediaVideo.style.transition }));
    assert.ok(dynamic.width > initial.width + 1); assert.match(dynamic.transition, /width (?:0\.5s|500ms)/);
    socket.send(JSON.stringify({ type: 'control', action: 'blackBorderTransition', value: false }));
    await page.waitForFunction(() => blackBorderTransition === false);
    await page.evaluate(() => { applyFit('contain'); window.testRegion = [0, 36, 320, 108]; });
    await page.waitForFunction(() => videoBlackBorders.tracker.rect.x === 0 && videoBlackBorders.tracker.rect.y > 0.18);
    assert.doesNotMatch(await page.evaluate(() => window.testBorderTransition), /width 200ms/);
    assert.equal(await page.evaluate(() => videoBlackBorders.enabled), true);
    socket.send(JSON.stringify({ type: 'control', action: 'autoBlackBorders', value: false }));
    await page.waitForFunction(() => !videoBlackBorders.enabled && !mediaVideo.style.clipPath);
    assert.equal(await page.evaluate(() => videoBlackBorders.timer), null);

    // 录制当前真实视频流，第二源故意不返回CORS头，确认普通直连仍可播放。
    videoBytes = Buffer.from(await page.evaluate(async () => {
        applyFit('contain');
        const recorder = new MediaRecorder(window.testStream, { mimeType: 'video/webm;codecs=vp8' });
        const chunks = [];
        const blob = new Promise(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks)); });
        recorder.start(); await new Promise(resolve => setTimeout(resolve, 900)); recorder.stop();
        return Array.from(new Uint8Array(await (await blob).arrayBuffer()));
    }));
    await page.evaluate(() => { clearInterval(window.testPaint); window.testStream.getTracks().forEach(track => track.stop()); mediaVideo.srcObject = null; videoBlackBorders.setEnabled(true); });
    const url = `http://127.0.0.1:${videoServer.address().port}/no-cors.webm`;
    socket.send(JSON.stringify({ type: 'url', mediaType: 'video', url }));
    await page.waitForFunction(url => mediaVideo.currentSrc === url && mediaVideo.readyState >= 2 && !mediaVideo.error, { timeout: 8000 }, url);
    assert.ok(corsRequests.some(origin => origin !== null), '先尝试允许取样的CORS直连');
    assert.ok(corsRequests.includes(null), 'CORS拒绝后重试相同直连源');
    socket.send(JSON.stringify({ type: 'control', action: 'autoBlackBorders', value: false }));
    await page.waitForFunction(() => !videoBlackBorders.enabled);
    await page.evaluate(() => { handleControl({ action: 'play', value: false }); mediaVideo.currentTime = 0; });
    const attempts = corsRequests.length;
    socket.send(JSON.stringify({ type: 'control', action: 'autoBlackBorders', value: true }));
    await page.waitForFunction(() => videoBlackBorders.enabled && mediaVideo.readyState >= 2 && mediaVideo.paused && !mediaVideo.error, { timeout: 8000 });
    assert.ok(corsRequests.length > attempts, '当前跨域视频重新开启检测时重试原URL并保持暂停');
    socket.send(JSON.stringify({ type: 'control', action: 'clearMedia' }));
    await page.waitForFunction(() => !videoBlackBorders.active && videoBlackBorders.timer === null);
    assert.equal(await page.evaluate(() => VideoBlackBorders.hasBorder(videoBlackBorders.tracker.rect)), false);
    await page.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext('2d');
        const paint = () => { context.fillStyle = 'black'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#258fed'; context.fillRect(0, 30, 320, 120); };
        paint(); window.cleanPaint = setInterval(paint, 30); window.cleanStream = canvas.captureStream(30);
        currentMediaType = 'video'; mediaVideo.style.display = 'block'; mediaImage.style.display = 'none';
        videoBlackBorders.setActive(true); mediaVideo.srcObject = window.cleanStream; await mediaVideo.play();
    });
    await page.waitForFunction(() => VideoBlackBorders.hasBorder(videoBlackBorders.tracker.rect));
    assert.equal(await page.evaluate(() => videoBlackBorders.unavailable), false, '跨域失败后同分辨率本地源仍可重新检测');
    await page.evaluate(() => { clearInterval(window.cleanPaint); window.cleanStream.getTracks().forEach(track => track.stop()); mediaVideo.srcObject = null; clearCurrentMedia(); });

    const control = await browser.newPage();
    await control.setContent('<input id="autoBlackBorders" type="checkbox" checked><input id="blackBorderTransition" type="checkbox" checked>');
    for (const file of ['controls.js', 'websocket.js']) await control.addScriptTag({ path: path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js', file) });
    const states = await control.evaluate(() => {
        window.currentDisplayId = 'one'; window.showToast = () => {};
        const sent = []; WebSocketManager.ws = { readyState: 1, send: json => sent.push(JSON.parse(json)) };
        WebSocketManager.handleMessage({ type: 'autoBlackBordersConfig', displayId: 'other', enabled: false });
        const before = document.getElementById('autoBlackBorders').checked;
        WebSocketManager.handleMessage({ type: 'autoBlackBordersConfig', displayId: 'one', enabled: false, transition: false });
        const after = document.getElementById('autoBlackBorders').checked;
        Controls.sendAutoBlackBorders(true);
        Controls.sendBlackBorderTransition(true);
        return { before, after, sent, transition: document.getElementById('blackBorderTransition').checked };
    });
    assert.equal(states.before, true); assert.equal(states.after, false);
    assert.equal(states.transition, false);
    assert.deepEqual(states.sent, [{ type: 'control', displayId: 'one', action: 'autoBlackBorders', value: true },
        { type: 'control', displayId: 'one', action: 'blackBorderTransition', value: true }]);

    for (const fps of [30, 60]) {
        const probe = await browser.newPage();
        await probe.goto(`http://127.0.0.1:${server.address().port}/fps-harness.html`);
        await probe.setContent('<video id="probeVideo" muted playsinline></video>');
        for (const file of ['video-black-borders.js', 'display-video-black-borders.js']) await probe.addScriptTag({ url: `http://127.0.0.1:${server.address().port}/js/${file}` });
        const throughput = await probe.evaluate(async fps => {
            const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
            const context = canvas.getContext('2d'); let paintId, count = 0;
            const paint = () => {
                context.fillStyle = 'black'; context.fillRect(0, 0, 640, 360);
                context.fillStyle = '#258fed'; context.fillRect(30, 50, 580, 260);
                context.fillStyle = count++ % 2 ? 'white' : 'gray'; context.fillRect(60, 70, 5, 5);
                paintId = requestAnimationFrame(paint);
            };
            paint();
            const video = document.getElementById('probeVideo'), stream = canvas.captureStream(fps);
            const detector = new VideoBlackBorderController(video);
            detector.setActive(true); video.srcObject = stream; await video.play();
            await new Promise(resolve => setTimeout(resolve, 250));
            const before = { ...detector.pipeline.stats }, first = video.getVideoPlaybackQuality().totalVideoFrames;
            await new Promise(resolve => setTimeout(resolve, 1000));
            const stats = { ...detector.pipeline.stats }, frames = video.getVideoPlaybackQuality().totalVideoFrames - first;
            detector.close(); await detector.pipeline.close(); cancelAnimationFrame(paintId); stream.getTracks().forEach(track => track.stop());
            return { frames, callbacks: stats.frames - before.frames, submitted: stats.submitted - before.submitted, skipped: stats.skipped - before.skipped };
        }, fps);
        t.diagnostic(JSON.stringify({ browserFps: fps, ...throughput }));
        assert.ok(throughput.frames > fps / 3);
        assert.ok(Math.abs(throughput.callbacks - throughput.frames) <= 3, '按实际视频帧回调去重，不按屏幕刷新重复计算');
        assert.ok(throughput.submitted > throughput.callbacks * 0.75, '正常负载大多数新视频帧都应完成取样提交');
        await probe.close();
    }
});
