'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const { createMediaLoopService } = require('../src/apps/server/modules/media/media-loop-control');
const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const read = file => fs.readFileSync(path.join(publicDir, file), 'utf8');

test('首次临时上传视频经正式showMedia上报时长、启用双手柄并实际循环，暂停加载也可设置', { timeout: 30000 }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-loop-temp-upload-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const fixture = path.join(directory, 'temporary.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10',
        '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture]);
    const audioFixture = path.join(directory, 'temporary.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '3', audioFixture]);
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const $ = cheerio.load(read('upload.html'));
    await page.setContent(`<div class="control-item">${$('#mediaLoopRange').closest('.control-item').html()}</div>
        <input id="tempMode" type="checkbox" checked><input id="tempMaxSize" value="300">
        <video id="mediaVideo" muted></video><audio id="mediaAudio"></audio><img id="mediaImage">
        <iframe id="mediaHtml"></iframe><div id="mediaText"></div><div id="waitingMessage"></div><div id="fileNameDisplay"></div>`);
    for (const file of ['media-loop.js', 'control-media-loop.js', 'websocket.js', 'upload.js']) {
        await page.addScriptTag({ path: path.join(publicDir, 'js', file) });
    }
    const display = { displayId: 'temp-display', state: {} };
    const progress = [], saves = [];
    let relay = Promise.resolve();
    const enqueue = operation => { relay = relay.then(operation); return relay; };
    const service = createMediaLoopService({
        persist: (_display, partial) => saves.push(structuredClone(partial)),
        broadcast: data => enqueue(() => page.evaluate(data => WebSocketManager.handleMessage(data), data)),
        send: (_id, data) => enqueue(() => page.evaluate(data => setMediaLoop(data.value), data))
    });
    await page.exposeFunction('displayReport', async data => {
        service.report(display, data);
        if (!['videoProgress', 'audioProgress'].includes(data.type)) return;
        progress.push(data);
        await page.evaluate(data => WebSocketManager.handleMessage(data), { ...data, displayId: display.displayId });
    });
    await page.exposeFunction('uploadMedia', async media => {
        display.state.currentMedia = media;
        service.sent(display, media);
        await relay;
        // 暂停恢复走同一个正式显示函数，确保不是靠播放后的timeupdate才启用控件。
        await page.evaluate(media => showMedia(media, true, true), media);
    });
    await page.exposeFunction('loopControl', async data => {
        service.handle(display, data);
        await relay;
    });
    await page.evaluate(() => {
        window.currentDisplayId = 'temp-display';
        window.showToast = () => {};
        ControlMediaLoop.init();
        WebSocketManager.sendMedia = media => window.uploadMedia(media);
        WebSocketManager.ws = { readyState: WebSocket.OPEN, send: text => window.loopControl(JSON.parse(text)) };
    });
    // 运行正式显示页的媒体加载函数和循环/进度接线；不启动整页的语音、模型及网络初始化。
    const displaySource = read('display.html');
    const mediaFunctions = displaySource.slice(displaySource.indexOf('        const mediaLoopPlayers ='),
        displaySource.indexOf('        // 清空停止全部媒体生命周期'));
    await page.addScriptTag({ content: `
        let currentMediaType = null, mediaLoadSequence = 0, htmlMediaAbortController = null;
        let pauseExpected = true, mediaIsPlaying = false, mediaRecoveryTimer = null, mediaRecoveryAttempts = 0;
        const displayWs = { readyState: WebSocket.OPEN, send: text => window.displayReport(JSON.parse(text)) };
        const mediaVideo = document.getElementById('mediaVideo'), mediaAudio = document.getElementById('mediaAudio');
        const mediaImage = document.getElementById('mediaImage'), mediaHtml = document.getElementById('mediaHtml');
        const mediaText = document.getElementById('mediaText'), waitingMessage = document.getElementById('waitingMessage');
        const fileNameDisplay = document.getElementById('fileNameDisplay');
        const stopHtmlScroll = () => {}, restartDynamicFitAfterMediaLoad = () => {}, activateTemporarily = () => {};
        const applyResumeTime = (media, time) => { if (time) media.currentTime = time; };
        const announceAndReport = () => {};
        const playVideoAuto = media => media.play(), playAudioAuto = media => media.play();
        const setMediaSourceWithFallback = (media, url) => { media.src = url; };
        const getCurrentPlayableMedia = () => ({video:mediaVideo, audio:mediaAudio}[currentMediaType] || null);
        ${mediaFunctions}
    ` });
    await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        await Upload.uploadFile(new File([bytes], 'temporary.mp4', { type: 'video/mp4' }));
    }, fs.readFileSync(fixture).toString('base64'));
    await page.waitForFunction(() => !document.getElementById('mediaLoopStart').disabled, { timeout: 5000 });
    assert.equal(display.state.currentMedia.type, 'base64');
    assert.equal(display.state.currentMedia.temp, true);
    assert.ok(progress.some(data => data.duration === 3));
    assert.equal(await page.$eval('#mediaVideo', video => video.paused), true);
    await page.evaluate(() => {
        for (const [id, value] of [['mediaLoopStart', '20'], ['mediaLoopEnd', '60']]) {
            const input = document.getElementById(id);
            input.value = value;
            input.dispatchEvent(new Event('input'));
            input.dispatchEvent(new Event('change'));
        }
    });
    await page.click('#mediaLoopEnabled');
    await page.waitForFunction(() => ControlMediaLoop.range.enabled);
    await relay;
    assert.deepEqual(display.state.mediaLoop, { enabled: true, startPercent: 20, endPercent: 60 });
    assert.ok(saves.some(state => state.mediaLoop?.enabled));
    await page.evaluate(async () => {
        window.loopbacks = 0;
        const video = document.getElementById('mediaVideo');
        let previous = 0;
        video.addEventListener('timeupdate', () => { if (previous > video.currentTime + 0.3) loopbacks++; previous = video.currentTime; });
        await video.play();
    });
    await page.waitForFunction(() => loopbacks > 0, { timeout: 6000 });
    await page.$eval('#mediaVideo', video => video.pause());
    await relay;
    // 同一显示页连续加载不同来源，不能依赖此前播放过URL视频才获得监听。
    for (const [type, mediaType, file, mimeType] of [['url', 'video', fixture, 'video/mp4'],
        ['base64', 'audio', audioFixture, 'audio/wav'], ['url', 'audio', audioFixture, 'audio/wav']]) {
        await page.evaluate(async ({ type, mediaType, data, mimeType }) => {
            const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
            const media = { type, mediaType, mimeType, fileName: 'compatibility', temp: true,
                ...(type === 'url' ? { url: URL.createObjectURL(new Blob([bytes], { type: mimeType })) } : { data }) };
            await window.uploadMedia(media);
        }, { type, mediaType, data: fs.readFileSync(file).toString('base64'), mimeType });
        await page.waitForFunction(() => !document.getElementById('mediaLoopStart').disabled, { timeout: 5000 });
        assert.equal(await page.evaluate(() => getCurrentPlayableMedia().paused), true);
    }
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
    const before = progress.length;
    await page.evaluate(() => {
        // 隐藏旧视频和当前音频的无效时长均不能伪造可编辑的进度。
        mediaVideo.dispatchEvent(new Event('timeupdate'));
        Object.defineProperty(mediaAudio, 'duration', { value: Infinity, configurable: true });
        mediaAudio.dispatchEvent(new Event('durationchange'));
        delete mediaAudio.duration;
    });
    assert.equal(progress.length, before);
    await page.evaluate(() => mediaAudio.dispatchEvent(new Event('timeupdate')));
    await page.waitForFunction(() => ControlMediaLoop.duration === 3);
    assert.equal(progress.length, before + 1, '连续加载后每个进度事件仍只上报一次');
});
