'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const puppeteer = require('puppeteer');
const { fixture } = require('./helpers/ogg-opus-fixture');
const { decodeOggOpusToWav } = require('../src/external/tts/tts-opus-decoder');
const { validateWav, wrapPcm } = require('../src/external/tts/tts-wav');
const cache = require('../src/external/tts/tts-audio-cache');
const { serveTtsAudio } = require('../src/apps/server/modules/tts/tts-audio-http');

test('本地Opus转WAV走现有缓存/HTTP/Audio，验证Range、结束、停止与下一句口型来源', { timeout: 15000 }, async () => {
    // 样本完全本地构造，不使用真实账号、上游帧、用户浏览器或主服务器。
    const decoded = validateWav(await decodeOggOpusToWav(fixture()));
    const wav = wrapPcm(Buffer.concat(Array(25).fill(decoded.samples)), decoded.format.readUInt32LE(4));
    const name = cache.storeAudio(wav);
    assert.match(name, /\.wav$/u);
    const app = express();
    app.use(serveTtsAudio);
    app.get('/', (req, res) => res.type('html').send('<!doctype html><title>本地WAV播放验证</title>'));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const temp = fs.mkdtempSync(path.join(path.resolve(__dirname, '..'), '.tmp-doubao-playback-'));
    let browser;
    try {
        const head = await fetch(`${base}/${name}`, { method: 'HEAD' });
        assert.equal(head.status, 200);assert.equal(head.headers.get('content-type'), 'audio/wav');
        assert.equal(Number(head.headers.get('content-length')), wav.length);
        assert.equal((await head.arrayBuffer()).byteLength, 0);
        const range = await fetch(`${base}/${name}`, { headers: { Range: 'bytes=0-43' } });
        assert.equal(range.status, 206);assert.equal(range.headers.get('content-range'), `bytes 0-43/${wav.length}`);
        assert.deepEqual(Buffer.from(await range.arrayBuffer()), wav.subarray(0, 44));
        const invalid = await fetch(`${base}/${name}`, { headers: { Range: `bytes=${wav.length}-` } });
        assert.equal(invalid.status, 416);
        const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath()].find(file => file && fs.existsSync(file));
        assert.ok(executablePath, '本地浏览器播放验收需要Chromium');
        browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: path.join(temp, 'profile'),
            args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
        const page = await browser.newPage();
        await page.goto(base);
        await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname,
            '../src/apps/web-mediacenter/ui/public/js/display-lipsync-audio.js'), 'utf8') });
        const result = await page.evaluate(async src => {
            const audio = new Audio();let changes = 0;
            audio.addEventListener('mmd-tts-source-change', () => changes++);
            const play = async text => {
                const ended = new Promise((resolve, reject) => {
                    audio.addEventListener('ended', resolve, { once: true });
                    audio.addEventListener('error', () => reject(new Error('本地WAV播放错误')), { once: true });
                });
                audio.src = src;
                const entry = DisplayLipSyncAudio.prepare(audio, text, src);
                await audio.play();await ended;
                // Chromium在同一事件各监听器间运行微任务；等待事件分发完成再核对正式监听器清理结果。
                await new Promise(resolve => setTimeout(resolve, 0));
                return { sequence: entry.sequence, cleared: DisplayLipSyncAudio.getState(audio) === null,
                    duration: audio.duration, progressed: audio.currentTime > 0 };
            };
            const first = await play('第一句');
            audio.src = src;DisplayLipSyncAudio.prepare(audio, '停止的句子', src);
            await audio.play();audio.pause();audio.currentTime = 0;DisplayLipSyncAudio.clear(audio);
            const stopped = audio.paused && DisplayLipSyncAudio.getState(audio) === null;
            const next = await play('下一句');
            audio.removeAttribute('src');audio.load();
            return { first, next, stopped, changes };
        }, `${base}/${name}`);
        assert.ok(result.first.cleared && result.first.progressed && result.next.cleared && result.next.progressed, JSON.stringify(result));
        assert.ok(result.first.duration > 0);assert.ok(result.next.sequence > result.first.sequence);
        assert.ok(result.stopped);assert.equal(result.changes, 6);
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();await new Promise(resolve => server.close(resolve));
        // 只删除本测试创建且已解析在工作区内的临时profile；不操作用户Chrome或其它目录。
        assert.ok(path.resolve(temp).startsWith(path.resolve(__dirname, '..') + path.sep));
        fs.rmSync(temp, { recursive: true, force: true });
    }
});
