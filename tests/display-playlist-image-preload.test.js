'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const WebSocket = require('ws');
const puppeteer = require('puppeteer');
const DisplayImagePreloader = require('../src/apps/web-mediacenter/ui/public/js/display-image-preloader.js');

function createFakeImageFactory() {
    const created = [];
    const factory = () => {
        const img = {
            _src: '',
            onload: null,
            onerror: null,
            decodeCalls: 0,
            set src(value) {
                this._src = value;
                if (value) created.push({ img: this, url: value });
            },
            get src() {
                return this._src;
            },
            decode() {
                this.decodeCalls++;
                return Promise.resolve();
            }
        };
        return img;
    };
    return { created, factory };
}

test('DisplayImagePreloader 预加载命中与 fallbackUrl 回退复用', async () => {
    const { created, factory } = createFakeImageFactory();
    const controller = DisplayImagePreloader.createController({ createImage: factory });

    controller.prefetchNext({
        listId: 'pl-1',
        index: 1,
        item: {
            url: 'http://bad-direct.example/1.jpg',
            fallbackUrl: '/api/proxy?url=1',
            mediaType: 'image'
        }
    });

    assert.equal(created.length, 1);
    assert.equal(created[0].url, 'http://bad-direct.example/1.jpg');

    // 直连失败 → 自动切换到 fallbackUrl
    created[0].img.onerror();
    assert.equal(created.length, 2);
    assert.equal(created[1].url, '/api/proxy?url=1');

    // fallback 成功并 decode
    created[1].img.onload();
    await new Promise(resolve => setImmediate(resolve));

    // 切到该项时直接复用预加载成功的 fallbackUrl，不重复请求
    let readyUrl = null;
    controller.loadForSwap({
        listId: 'pl-1',
        index: 1,
        data: { type: 'url', url: 'http://bad-direct.example/1.jpg', fallbackUrl: '/api/proxy?url=1', mediaType: 'image' },
        isStale: () => false,
        onReady: url => { readyUrl = url; },
        onError: () => assert.fail('不应触发失败')
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readyUrl, '/api/proxy?url=1');
    assert.equal(created.length, 2);
});

test('DisplayImagePreloader 在途预加载合并、全失败与过期令牌拦截', async () => {
    const { created, factory } = createFakeImageFactory();
    const controller = DisplayImagePreloader.createController({ createImage: factory });

    // 启动第 1 项预加载（仍在加载中）
    controller.prefetchNext({
        listId: 'pl-2',
        index: 1,
        item: { url: 'http://slow.example/a.jpg', fallbackUrl: '/proxy/a.jpg', mediaType: 'image' }
    });
    assert.equal(created.length, 1);

    // 预加载未完成时立即切到第 1 项：复用在途请求，不重发
    let stale = false;
    let readyCount = 0;
    let errorCount = 0;
    controller.loadForSwap({
        listId: 'pl-2',
        index: 1,
        data: { type: 'url', url: 'http://slow.example/a.jpg', fallbackUrl: '/proxy/a.jpg', mediaType: 'image' },
        isStale: () => stale,
        onReady: () => { readyCount++; },
        onError: () => { errorCount++; }
    });
    assert.equal(created.length, 1);

    // 模拟切走使旧请求过期，随后旧请求完成也不应回调
    stale = true;
    created[0].img.onload();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readyCount, 0);
    assert.equal(errorCount, 0);

    // 新项直连和备用都失败时只回调一次 onError
    let failed = 0;
    controller.loadForSwap({
        listId: 'pl-2',
        index: 2,
        data: { type: 'url', url: 'http://bad1.example/b.jpg', fallbackUrl: 'http://bad2.example/b.jpg', mediaType: 'image' },
        isStale: () => false,
        onReady: () => assert.fail('不应触发成功'),
        onError: () => { failed++; }
    });
    assert.equal(created.length, 2);
    created[1].img.onerror();
    assert.equal(created.length, 3);
    assert.equal(created[2].url, 'http://bad2.example/b.jpg');
    created[2].img.onerror();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(failed, 1);
});

// 生成不同尺寸和颜色的合法 PNG（1x1 / 2x3 / 3x2，用于验证自然宽高与切换）
function createSolidPng(width, height, rgb) {
    const zlib = require('node:zlib');
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
    }
    const crc32 = buf => {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const typeBuf = Buffer.from(type, 'ascii');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
        return Buffer.concat([len, typeBuf, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    const rowLen = 1 + width * 3;
    const raw = Buffer.alloc(rowLen * height);
    for (let y = 0; y < height; y++) {
        const off = y * rowLen;
        raw[off] = 0;
        for (let x = 0; x < width; x++) {
            raw[off + 1 + x * 3] = rgb[0];
            raw[off + 1 + x * 3 + 1] = rgb[1];
            raw[off + 1 + x * 3 + 2] = rgb[2];
        }
    }
    const idat = zlib.deflateSync(raw);
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

test('真实浏览器：批量外部 no-store 图片预加载与切换期间不露出背景，支持回退、全失败跳过、快切与暂停恢复', { timeout: 60000 }, async () => {
    const img1 = createSolidPng(40, 30, [220, 40, 40]);
    const img2 = createSolidPng(80, 50, [40, 180, 70]);
    const img3 = createSolidPng(60, 90, [40, 90, 230]);
    const img4 = createSolidPng(100, 100, [230, 180, 30]);

    const app = express();
    const requestLog = [];
    app.get('/ext/:name', async (req, res) => {
        const name = req.params.name;
        const delay = Number(req.query.delay || 0);
        requestLog.push(name);
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        if (name.startsWith('fail')) {
            res.status(404).end();
            return;
        }
        const map = { '1.png': img1, '2.png': img2, '3.png': img3, '4.png': img4 };
        const buf = map[name];
        if (!buf) {
            res.status(404).end();
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.type('image/png').send(buf);
    });
    app.get('/tiny.mp4', (_req, res) => res.status(200).type('video/mp4').send(Buffer.alloc(0)));
    app.use(express.static('src/apps/web-mediacenter/ui/public'));

    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server });
    const progressEvents = [];
    let displaySocket = null;
    wss.on('connection', socket => {
        displaySocket = socket;
        socket.on('message', raw => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'playlistProgress') progressEvents.push(msg);
            } catch { /* ignore */ }
        });
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 800, height: 600 });
        await page.goto(`${base}/display.html?displayId=img-preload-test`, { waitUntil: 'load' });
        await page.waitForFunction(() => Boolean(window.DisplayImagePreloader), { timeout: 5000 });
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.ok(displaySocket, 'WebSocket 应已连接');

        // 启动每帧可见性哨兵：在第一张图片显示之后，切图期间绝不允许 img 与 hold 同时不可见或无尺寸
        await page.evaluate(() => {
            window.__imageBlankFrames = [];
            window.__watchImageSwap = false;
            const check = () => {
                if (window.__watchImageSwap) {
                    const img = document.getElementById('mediaImage');
                    const hold = document.getElementById('mediaImageHold');
                    const imgVisible = img && getComputedStyle(img).display !== 'none'
                        && getComputedStyle(img).visibility !== 'hidden'
                        && img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0;
                    const holdVisible = hold && getComputedStyle(hold).display !== 'none'
                        && hold.getBoundingClientRect().width > 0;
                    if (!imgVisible && !holdVisible) {
                        window.__imageBlankFrames.push({
                            time: performance.now(),
                            imgDisplay: img?.style.display,
                            imgVis: img?.style.visibility,
                            imgSrc: img?.getAttribute('src'),
                            holdDisplay: hold?.style.display
                        });
                    }
                }
                requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
        });

        // 1. 发送模拟 playlistUrlRequest 列表：慢速图 + 直连失败回退 + 双重失败项 + 循环
        displaySocket.send(JSON.stringify({
            type: 'playlistStart',
            listId: 'pl-nostore',
            interval: 0.7,
            loop: true,
            announceName: false,
            playlist: [
                { url: `${base}/ext/1.png`, fileName: '1.png', mediaType: 'image' },
                { url: `${base}/ext/fail-direct`, fallbackUrl: `${base}/ext/2.png?delay=180`, fileName: '2.png', mediaType: 'image' },
                { url: `${base}/ext/fail-both-1`, fallbackUrl: `${base}/ext/fail-both-2`, fileName: 'broken.png', mediaType: 'image' },
                { url: `${base}/ext/3.png?delay=180`, fileName: '3.png', mediaType: 'image' }
            ]
        }));

        await page.waitForFunction(() => {
            const img = document.getElementById('mediaImage');
            return img && img.complete && img.naturalWidth === 40 && img.style.display === 'block';
        }, { timeout: 5000 });

        // 首张图片上屏后开始全程监控是否有空白闪烁
        await page.evaluate(() => { window.__watchImageSwap = true; });

        // 等待第 2 张（经 fallbackUrl）和跳过第 3 张（全失败）后到达第 4 张 3.png (60x90)
        await page.waitForFunction(() => {
            const img = document.getElementById('mediaImage');
            return img && img.complete && img.naturalWidth === 60 && img.naturalHeight === 90;
        }, { timeout: 8000 });

        const blankFrames = await page.evaluate(() => window.__imageBlankFrames);
        assert.equal(blankFrames.length, 0, `切换期间不得露出背景空白帧，发现: ${JSON.stringify(blankFrames)}`);

        // 核实加载期间没有把旧图宽高误上报成新项尺寸
        const item2Reports = progressEvents.filter(e => e.listId === 'pl-nostore' && e.index === 1 && e.width !== undefined);
        assert.ok(item2Reports.every(e => e.width === 80 && e.height === 50), `第 2 项尺寸上报应均为 80x50，实际: ${JSON.stringify(item2Reports)}`);
        const item4Reports = progressEvents.filter(e => e.listId === 'pl-nostore' && e.index === 3 && e.width !== undefined);
        assert.ok(item4Reports.every(e => e.width === 60 && e.height === 90), `第 4 项尺寸上报应均为 60x90，实际: ${JSON.stringify(item4Reports)}`);

        // 2. 快速连续切页与过期异步回调防覆盖：从 1.png 切向超慢 2.png(450ms) 后立刻切向 4.png(30ms)
        await page.evaluate(() => { window.__watchImageSwap = false; });
        displaySocket.send(JSON.stringify({
            type: 'playlistStart',
            listId: 'pl-race',
            interval: 10,
            loop: false,
            announceName: false,
            playlist: [
                { url: `${base}/ext/1.png`, fileName: 'r1.png', mediaType: 'image' },
                { url: `${base}/ext/2.png?delay=450`, fileName: 'r2-slow.png', mediaType: 'image' },
                { url: `${base}/ext/4.png?delay=30`, fileName: 'r3-fast.png', mediaType: 'image' }
            ]
        }));
        await page.waitForFunction(() => document.getElementById('mediaImage').naturalWidth === 40, { timeout: 5000 });
        await page.evaluate(() => { window.__watchImageSwap = true; });
        displaySocket.send(JSON.stringify({ type: 'playlistControl', action: 'next' }));
        await new Promise(resolve => setTimeout(resolve, 60));
        displaySocket.send(JSON.stringify({ type: 'playlistControl', action: 'next' }));

        await page.waitForFunction(() => document.getElementById('mediaImage').naturalWidth === 100, { timeout: 5000 });
        // 等待超慢的 r2-slow 回调早就返回，确认不会把当前 4.png (100x100) 覆盖回 2.png (80x50)
        await new Promise(resolve => setTimeout(resolve, 550));
        const afterRace = await page.evaluate(() => ({
            width: document.getElementById('mediaImage').naturalWidth,
            fileName: document.getElementById('fileNameDisplay').textContent,
            blank: window.__imageBlankFrames.length
        }));
        assert.equal(afterRace.width, 100);
        assert.equal(afterRace.fileName, '4.png');
        assert.equal(afterRace.blank, 0);

        // 3. 暂停与恢复，以及旋转/裁剪下不露出背景，切换至非图片项清理 hold
        displaySocket.send(JSON.stringify({ type: 'playlistControl', action: 'pause' }));
        await new Promise(resolve => setTimeout(resolve, 100));
        const pausedCountBefore = progressEvents.length;
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(progressEvents.length, pausedCountBefore, '暂停后不应继续推进播放列表');

        // 开启旋转与适应模式，恢复播放后重新启动新列表验证 loop 与排版正确且无空白帧
        displaySocket.send(JSON.stringify({ type: 'control', action: 'rotate', value: 90 }));
        displaySocket.send(JSON.stringify({ type: 'control', action: 'fit', value: 'cover' }));
        displaySocket.send(JSON.stringify({
            type: 'playlistStart',
            listId: 'pl-loop-rot',
            interval: 0.25,
            loop: true,
            announceName: false,
            playlist: [
                { url: `${base}/ext/1.png`, fileName: 'l1.png', mediaType: 'image' },
                { url: `${base}/ext/3.png?delay=100`, fileName: 'l2.png', mediaType: 'image' }
            ]
        }));
        await page.waitForFunction(() => document.getElementById('mediaImage').naturalWidth === 40, { timeout: 5000 });
        await page.evaluate(() => { window.__watchImageSwap = true; });
        await page.waitForFunction(() => document.getElementById('mediaImage').naturalWidth === 60, { timeout: 5000 });
        // 循环回第 1 张 40x30
        await page.waitForFunction(() => document.getElementById('mediaImage').naturalWidth === 40, { timeout: 5000 });
        const rotBlank = await page.evaluate(() => ({
            blank: window.__imageBlankFrames.length,
            transform: document.getElementById('mediaImage').style.transform
        }));
        assert.equal(rotBlank.blank, 0);
        assert.match(rotBlank.transform, /rotate\(90deg\)/);

        // 切入视频单媒体打断列表，确认 hold 与图片元素均隐藏
        await page.evaluate(() => { window.__watchImageSwap = false; });
        displaySocket.send(JSON.stringify({ type: 'url', url: `${base}/tiny.mp4`, mediaType: 'video', fileName: 'tiny.mp4' }));
        await page.waitForFunction(() => document.getElementById('mediaVideo').style.display === 'block', { timeout: 5000 });
        const videoState = await page.evaluate(() => ({
            imgDisplay: document.getElementById('mediaImage').style.display,
            holdDisplay: document.getElementById('mediaImageHold').style.display
        }));
        assert.equal(videoState.imgDisplay, 'none');
        assert.equal(videoState.holdDisplay, 'none');
    } finally {
        await browser.close();
        wss.close();
        await new Promise(resolve => server.close(resolve));
    }
});
