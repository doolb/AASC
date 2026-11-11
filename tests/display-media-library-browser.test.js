'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('媒体库页面和提示显示在 MMD 舞台与设置面板上方', { skip: !fs.existsSync(chrome), timeout: 30000 }, async t => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<div id="stage" style="position:fixed;inset:0;z-index:10001;background:red"></div><div class="display-media-library-panel"><button id="mediaButton">媒体库</button></div><div class="display-media-library-notice" id="notice">提示</div>');
    await page.addStyleTag({ path: path.join(publicDir, 'css/display-media-library.css') });
    assert.equal(await page.evaluate(() => document.elementFromPoint(5, 5).closest('.display-media-library-panel') !== null), true);
    await page.click('#mediaButton');
    assert.ok(await page.$eval('#notice', node => Number(getComputedStyle(node).zIndex) > Number(getComputedStyle(document.getElementById('stage')).zIndex)));
});

test('本机显示端媒体库按钮、浏览、单文件播放与文件夹批量播放', {
    skip: !fs.existsSync(chrome), timeout: 45000
}, async t => {
    const $ = cheerio.load(fs.readFileSync(path.join(publicDir, 'display.html'), 'utf8'));
    $('script, link[rel="stylesheet"]').remove();
    const html = $.html();
    const app = express();
    app.get('/display.html', (req, res) => res.type('html').send(html));
    app.get('/api/display-local/libraries', (req, res) => res.json({
        libraries: [
            { id: 'local1', name: '上传', type: 'local' },
            { id: 'quark1', name: '夸克分享', type: 'quark' },
            { id: 'display-bilibili', name: 'B 站', type: 'bilibili' },
            { id: 'task-auto:hongguo', name: '红果短剧', type: 'task', taskId: 'hongguo' }
        ]
    }));
    app.get('/api/display-local/list', (req, res) => {
        if (req.query.libraryId === 'task-auto:hongguo') return res.status(410).json({ code: 'TASK_SOURCE_STOPPED' });
        const dir = String(req.query.path || '/');
        const entries = dir === '/'
            ? [
                { name: '合集A', path: '/合集A', type: 'directory' },
                { name: 'a.mp4', path: '/a.mp4', type: 'file', mediaType: 'video', directUrl: '/uploads/a.mp4', proxyUrl: '' }
            ]
            : [{ name: 'b.mp4', path: `${dir}/b.mp4`, type: 'file', mediaType: 'video', directUrl: `${dir}/b.mp4`, proxyUrl: '' }];
        res.json({ path: dir, parent: '/', entries });
    });
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/display.html`);
    await page.addScriptTag({ path: path.join(publicDir, 'js/display-media-library.js') });
    await page.evaluate(() => {
        window.sent = [];
        window.played = [];
        window.DisplayMediaLibrary.init({
            send: message => window.sent.push(message),
            playMedia: message => window.played.push(message)
        });
    });

    assert.equal(await page.$eval('#displayMediaLibraryToggle', node => node.hidden), false);
    assert.equal(await page.evaluate(() => {
        const actions = document.getElementById('displayGameChatActions');
        const children = [...actions.children];
        return children.indexOf(document.getElementById('displayMediaLibraryToggle'))
            < children.indexOf(document.getElementById('displayGameToggle'));
    }), true);

    await page.click('#displayMediaLibraryToggle');
    await page.waitForSelector('.display-media-library-source');
    assert.deepEqual(
        await page.$$eval('.display-media-library-source', nodes => nodes.map(node => node.textContent)),
        ['上传', '夸克分享', 'B 站', '红果短剧']
    );
    assert.deepEqual(
        await page.$$eval('.display-media-library-group-title', nodes => nodes.map(node => node.textContent)),
        ['本地媒体', '国内媒体']
    );
    for (const sourceId of ['quark1', 'display-bilibili', 'task-auto:hongguo', 'local1']) {
        await page.click(`[data-library-id="${sourceId}"]`);
        assert.equal(await page.$eval(`[data-library-id="${sourceId}"]`, node => node.classList.contains('active')), true);
    }
    await page.waitForSelector('.display-media-library-entry');
    await page.evaluate(() => [...document.querySelectorAll('.display-media-library-entry-name')]
        .find(node => node.textContent === 'a.mp4').click());
    assert.equal(await page.evaluate(() => window.played.length), 0);
    await page.evaluate(() => {
        const request = window.sent.at(-1);
        const reply = { type: 'displayMediaStart', requestId: request.requestId, media: { type: 'url', url: '/uploads/a.mp4', fileName: 'a.mp4', mediaType: 'video' } };
        window.DisplayMediaLibrary.handleServerMessage(reply);
        window.DisplayMediaLibrary.handleServerMessage(reply);
    });
    assert.equal(await page.evaluate(() => window.played.length), 1);
    assert.deepEqual(await page.evaluate(() => window.played.at(-1)), {
        type: 'url', url: '/uploads/a.mp4', fileName: 'a.mp4', mediaType: 'video'
    });
    assert.equal(await page.$eval('#displayMediaLibraryPanel', node => node.hidden), true);

    await page.click('#displayMediaLibraryToggle');
    await page.waitForSelector('.display-media-library-entry');
    await page.evaluate(() => [...document.querySelectorAll('.display-media-library-batch')]
        .find(node => node.closest('.display-media-library-entry').textContent.includes('合集A')).click());
    const folderRequest = await page.evaluate(() => window.sent.at(-1));
    assert.equal(folderRequest.type, 'displayPlaylistRequest');
    assert.equal(folderRequest.libraryId, 'local1');
    assert.equal(folderRequest.path, '/合集A');
    assert.equal(typeof folderRequest.requestId, 'string');
    // 打开面板单文件播放后，迟到的带标识列表不得进入真实显示端播放分支。
    await page.click('#displayMediaLibraryToggle');
    await page.waitForSelector('.display-media-library-entry');
    await page.evaluate(() => [...document.querySelectorAll('.display-media-library-entry-name')]
        .find(node => node.textContent === 'a.mp4').click());
    assert.equal(await page.evaluate(() => window.sent.at(-1).type), 'displayPlaylistCancel');
    assert.equal(await page.evaluate(() => window.played.length), 1);
    assert.equal(await page.evaluate(requestId => window.DisplayMediaLibrary.handleServerMessage({ type: 'playlistStart', requestId }), folderRequest.requestId), false);
    await page.evaluate(() => window.DisplayMediaLibrary.handleServerMessage({ type: 'displayPlaylistError', requestId: window.sent.at(-1).requestId, message: '解析失败' }));
    assert.equal(await page.$eval('#displayMediaLibraryNotice', node => node.textContent), '解析失败');
    assert.equal(await page.evaluate(() => window.played.length), 1);
    await page.evaluate(() => {
        document.querySelector('.display-media-library-entry-name:last-child')?.click();
        window.DisplayMediaLibrary.handleServerMessage({ type: 'displayMediaDisconnected' });
    });
    assert.equal(await page.$eval('#displayMediaLibraryNotice', node => node.textContent), '连接已断开，请稍后重试');
    await page.evaluate(() => window.DisplayMediaLibrary.handleServerMessage({ type: 'displayMediaStart', requestId: window.sent.at(-1).requestId, media: { type: 'url', url: '/late.mp4' } }));
    assert.equal(await page.evaluate(() => window.played.length), 1);
    assert.equal(await page.evaluate(requestId => window.DisplayMediaLibrary.handleServerMessage({
        type: 'playlistStart', requestId
    }), folderRequest.requestId), true);
    assert.equal(await page.$eval('#displayMediaLibraryPanel', node => node.hidden), true);

    await page.evaluate(() => window.DisplayMediaLibrary.handleServerMessage({
        type: 'displayPlaylistError', message: '该目录没有可播放的媒体'
    }));
    assert.equal(await page.$eval('#displayMediaLibraryNotice', node => node.hidden), false);
    assert.equal(await page.$eval('#displayMediaLibraryNotice', node => node.textContent), '该目录没有可播放的媒体');
    await page.click('#displayMediaLibraryToggle');
    await page.waitForSelector('.display-media-library-source');
    await page.evaluate(() => document.querySelector('[data-library-id="task-auto:hongguo"]').click());
    await page.waitForFunction(() => document.getElementById('displayMediaLibraryStatus').textContent === '任务媒体源已停止');
    assert.equal(await page.$eval('#displayMediaLibraryPath', node => node.textContent), '/');
    assert.equal(await page.$$eval('.display-media-library-entry', nodes => nodes.length), 0);
    assert.deepEqual(errors, []);
});

test('非本机主机名不显示媒体库入口', {
    skip: !fs.existsSync(chrome), timeout: 45000
}, async t => {
    const $ = cheerio.load(fs.readFileSync(path.join(publicDir, 'display.html'), 'utf8'));
    $('script, link[rel="stylesheet"]').remove();
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent($.html());
    await page.addScriptTag({ path: path.join(publicDir, 'js/display-media-library.js') });
    await page.evaluate(() => window.DisplayMediaLibrary.init({ send: () => {}, playMedia: () => {}, hostname: '192.168.1.20' }));
    assert.equal(await page.$eval('#displayMediaLibraryToggle', node => node.hidden), true);
});

test('真实 display.html 内联初始化调用 showMedia URL 分支', {
    skip: !fs.existsSync(chrome), timeout: 45000
}, async t => {
    const app = express();
    app.get('/api/display-local/libraries', (req, res) => res.json({ libraries: [{ id: 'disk', type: 'local', name: '真实显示端' }] }));
    app.get('/api/display-local/list', (req, res) => res.json({ path: '/', parent: '/', entries: [
        { name: 'actual.png', path: '/actual.png', type: 'file', mediaType: 'image', directUrl: '/actual.png' }
    ] }));
    app.get('/actual.png', (req, res) => res.type('png').send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')));
    const os = require('node:os');
    const fsp = require('node:fs/promises');
    const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
    const { createDisplayLocalRouter } = require('../src/apps/server/modules/media/display-local-media');
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aasc-display-markdown-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    await fsp.mkdir(path.join(root, 'collection'));
    await fsp.writeFile(path.join(root, 'collection', 'batch.png'), 'batch');
    await fsp.writeFile(path.join(root, 'actual.md'), '# 真正的 Markdown\n\n这是测试正文。');
    await fsp.writeFile(path.join(root, 'actual.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
    const manager = new MediaLibraryManager({ configPath: path.join(root, 'libraries.json'), getLocalIP: () => '127.0.0.1', isHttps: () => false });
    await manager.addLibraryFromConfig({ id: 'disk', name: '磁盘', type: 'local', path: root });
    await manager.addLibraryFromConfig({ id: 'markdown', name: '真实 Markdown', type: 'local', path: root });
    app.use('/api/real-display-local', createDisplayLocalRouter({ mediaLibraryManager: manager }));
    app.use('/media/markdown', express.static(root));
    app.use('/media/disk', express.static(root));
    app.get('/api/media-libraries/markdown/proxy/actual.md', (req, res) => res.type('text').sendFile(path.join(root, 'actual.md')));
    app.get('/js/sentence-splitter.js', (req, res) => res.sendFile(path.resolve(__dirname, '../src/core/utils/sentence-splitter.js')));
    app.use(express.static(publicDir));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => { server.closeAllConnections(); server.close(); });
    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ server });
    const messages = [];
    const { createDisplayPlaylistRequestHandler, listDisplayLibraries } = require('../src/apps/server/modules/media/display-local-media');
    const { PlaylistManager } = require('../src/apps/web-mediacenter/modules/media/playlist-app-service');
    const playlistManager = new PlaylistManager(manager);
    let display = null;
    let delayedPlaylist = null;
    const handler = createDisplayPlaylistRequestHandler({
        getLibraries: () => listDisplayLibraries(manager),
        buildPlaylist: (id, dir) => playlistManager.buildFromLibrary(id, dir, { recursive: false, mediaTypes: ['image', 'text'] }),
        getDisplayData: () => display, persist: () => {},
        sendToDisplay: (id, message) => {
            if (message.type === 'playlistStart') { delayedPlaylist = message; return; }
            display.ws.send(JSON.stringify(message));
        }
    });
    wss.on('connection', ws => {
        display = { ws, state: {} };
        ws.on('message', payload => {
            const message = JSON.parse(payload);
            messages.push(message);
            if (['displayPlaylistCancel', 'displayPlaylistRequest'].includes(message.type)) void handler('real-display', message, ws);
        });
    });
    t.after(() => { for (const ws of wss.clients) ws.terminate(); wss.close(); });
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/display.html`);
    await page.waitForFunction(() => typeof window.DisplayMediaLibrary?.open === 'function' && !document.getElementById('displayMediaLibraryToggle').hidden);
    await page.waitForFunction(() => displayWs?.readyState === WebSocket.OPEN);
    await page.evaluate(() => {
        window.singlePlayCount = 0;
        const original = showMedia;
        showMedia = (...args) => { window.singlePlayCount++; return original(...args); };
    });
    await page.evaluate(() => window.DisplayMediaLibrary.open());
    await page.waitForSelector('.display-media-library-entry-name');
    await page.evaluate(() => document.querySelector('.display-media-library-entry-name').click());
    await page.waitForFunction(() => document.getElementById('mediaImage').getAttribute('src') === '/media/disk/actual.png');
    assert.equal(await page.$eval('#mediaImage', node => node.style.display), 'block');
    assert.equal(messages.some(message => message.type === 'displayPlaylistCancel'), true);
    assert.equal(await page.evaluate(() => window.singlePlayCount), 1);
    // 切换到真实磁盘库接口，验证 Markdown 格式穿过 normalizeDisplayEntries 和 showMedia。
    await page.evaluate(async () => {
        const originalFetch = window.fetch;
        window.fetch = (input, options) => originalFetch(String(input).replace('/api/display-local/', '/api/real-display-local/'), options);
        window.DisplayMediaLibrary.open();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.display-media-library-entry-name')].some(node => node.textContent === 'actual.md'));
    await page.evaluate(() => [...document.querySelectorAll('.display-media-library-entry-name')].find(node => node.textContent === 'actual.md').click());
    await page.waitForSelector('#mediaTextContent h1');
    assert.equal(await page.$eval('#mediaTextContent h1', node => node.textContent), '真正的 Markdown');
    assert.equal(await page.evaluate(() => window.singlePlayCount), 2);
    // 真实服务端已保存批量列表但延迟发送；随后的单文件解析失败必须补齐权威列表。
    await page.evaluate(() => window.DisplayMediaLibrary.open());
    await page.waitForSelector('.display-media-library-batch');
    await page.evaluate(() => document.querySelector('.display-media-library-batch').click());
    await new Promise(resolve => setImmediate(resolve));
    await page.waitForFunction(() => document.getElementById('displayMediaLibraryPanel').hidden);
    const refreshedList = page.waitForResponse(response => response.url().includes('/api/real-display-local/list?'));
    await page.evaluate(() => window.DisplayMediaLibrary.open());
    await refreshedList;
    await page.waitForFunction(() => [...document.querySelectorAll('.display-media-library-entry-name')].some(node => node.textContent === 'actual.md'));
    await fsp.unlink(path.join(root, 'actual.md'));
    await page.evaluate(() => [...document.querySelectorAll('.display-media-library-entry-name')].find(node => node.textContent === 'actual.md').click());
    await page.waitForFunction(() => playlistState?.playlist?.some(item => item.fileName === 'batch.png'));
    assert.equal(await page.evaluate(() => playlistState.listId), delayedPlaylist.listId);
    assert.equal(display.state.currentPlaylist.startData.listId, delayedPlaylist.listId);
    assert.equal(await page.evaluate(requestId => window.DisplayMediaLibrary.handleServerMessage({ type: 'playlistStart', requestId }), delayedPlaylist.requestId), true);

});
