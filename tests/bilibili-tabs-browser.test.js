'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

test('B站标签展示封面标题并支持加入、播放与移除', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (request.url().startsWith('https://i0.hdslb.com/')) {
            return request.respond({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
        }
        return request.continue();
    });
    await page.setContent(`<div class="media-library-container">${$('.media-library-container').first().html()}</div>`);
    await page.addScriptTag({ path: path.join(root, 'js/upload.js') });
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.sent = [];
        window.showToast = () => {};
        window.WebSocketManager = { ws: { readyState: WebSocket.OPEN, send: json => window.sent.push(JSON.parse(json)) }, sendMedia: data => window.sent.push(data) };
        window.MediaLibrary.handleBilibiliList({ videos: [{ bvid: 'BV1B7411m7LV', page: 2, title: '视频标题', cover: 'https://i0.hdslb.com/a.jpg', url: 'https://www.bilibili.com/video/BV1B7411m7LV?p=2' }] });
    });
    await page.click('#mediaTabBilibili');
    assert.match(await page.$eval('#bilibiliVideoList', el => el.textContent), /视频标题 · P2/);
    assert.equal(await page.$eval('.bilibili-video-cover', el => el.getAttribute('src')), 'https://i0.hdslb.com/a.jpg');
    assert.equal(await page.$eval('#mediaLibraryContent', el => getComputedStyle(el).display), 'none');
    await page.type('#bilibiliVideoInput', 'https://www.bilibili.com/video/BV1B7411m7LV?p=2');
    await page.$eval('#bilibiliVideoBar button', el => el.click());
    await page.$eval('.bilibili-video-actions button', el => el.click());
    await page.$eval('.bilibili-video-actions button:nth-child(2)', el => el.click());
    const sent = await page.evaluate(() => window.sent);
    assert.equal(sent[0].type, 'bilibiliListAdd');
    assert.match(sent[1].url, /player\.bilibili\.com\/player\.html/);
    assert.equal(sent[2].type, 'bilibiliListRemove');
});

test('B 站当前分类批量播放将文件夹与设置发送到服务端', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`<div class="media-library-container">${$('.media-library-container').first().html()}</div>`);
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.showToast = () => {};
        window.WebSocketManager = { sendPlaylistRequest: data => { window.request = data; return true; } };
        MediaLibrary.bilibiliVideos = [{ url: 'https://www.bilibili.com/video/BV1B7411m7LV' }];
        MediaLibrary.shareFolders.bilibili = { folders: [{ id: 'folder-a', name: '分类' }], entries: { 'https://www.bilibili.com/video/BV1B7411m7LV': 'folder-a' } };
        MediaLibrary.selectedShareFolder.bilibili = 'folder-a';
        document.getElementById('bilibiliVideoBar').style.display = '';
    });
    // 工具栏新增首页/弹幕后，批量播放不再固定在末尾，改用 onclick 精确定位。
    await page.click('#bilibiliVideoBar button[onclick="MediaLibrary.showBilibiliBatchPlayDialog()"]');
    assert.equal(await page.$eval('.playlist-settings-dialog .dialog-title', e => e.textContent), '批量播放 B 站视频');
    assert.equal(await page.$$('input[name="plMediaType"]').then(x => x.length), 0);
    await page.click('#plConfirmBtn');
    const request = await page.evaluate(() => window.request);
    assert.equal(request.libraryType, 'bilibili');
    assert.equal(request.folderId, 'folder-a');
    assert.equal(request.mode, 'sequence');
    assert.equal(request.loop, true);
});

test('B 站收藏列表输入支持加入分类及直接批量播放', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`<div class="media-library-container">${$('.media-library-container').first().html()}</div>`);
    await page.addScriptTag({ path: path.join(root, 'js/upload.js') });
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.sent = []; window.showToast = () => {};
        window.WebSocketManager = { ws: { readyState: WebSocket.OPEN, send: text => window.sent.push(JSON.parse(text)) }, sendPlaylistRequest: data => { window.sent.push(data); return true; } };
        MediaLibrary.selectedShareFolder.bilibili = 'a';
        document.getElementById('bilibiliVideoBar').style.display = '';
    });
    await page.type('#bilibiliVideoInput', 'https://www.bilibili.com/list/ml3316957636?oid=1');
    await page.click('#bilibiliVideoBar button:nth-of-type(1)');
    await page.click('#bilibiliVideoBar button:nth-of-type(2)');
    await page.click('#plConfirmBtn');
    const sent = await page.evaluate(() => window.sent);
    assert.equal(sent[0].type, 'bilibiliListAdd');
    assert.equal(sent[1].key, 'https://www.bilibili.com/list/ml3316957636');
    assert.equal(sent[1].folderId, 'a');
    assert.equal(sent[2].collectionUrl, 'https://www.bilibili.com/list/ml3316957636');
});

test('打开 B 站收藏列表、播放分集、返回并忽略过期响应', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`<div class="media-library-container">${$('.media-library-container').first().html()}</div>`);
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.sent = []; window.showToast = () => {};
        window.WebSocketManager = { ws: { readyState: WebSocket.OPEN, send: text => window.sent.push(JSON.parse(text)) } };
        MediaLibrary.activeTab = 'bilibili';
        MediaLibrary.playBilibiliUrl = url => { window.played = url; };
        MediaLibrary.handleBilibiliList({ videos: [{ url: 'https://www.bilibili.com/list/ml1', title: '收藏', collection: true }] });
        MediaLibrary.renderTabs();
    });
    await page.click('.bilibili-video-card');
    assert.match(await page.$eval('#bilibiliVideoList', e => e.textContent), /正在读取/);
    const request = await page.evaluate(() => window.sent[0]);
    assert.equal(request.type, 'bilibiliCollectionGet');
    await page.evaluate(request => MediaLibrary.handleBilibiliCollection({ requestId: request.requestId, title: '收藏', videos: [{ bvid: 'BV1B7411m7LV', page: 2, title: '视频', cover: '' }] }), request);
    assert.match(await page.$eval('#bilibiliVideoList', e => e.textContent), /视频 · P2/);
    await page.click('.bilibili-video-actions button');
    assert.equal(await page.evaluate(() => window.played), 'https://www.bilibili.com/video/BV1B7411m7LV?p=2');
    await page.click('.bilibili-collection-header button');
    assert.match(await page.$eval('#bilibiliVideoList', e => e.textContent), /收藏列表 · 收藏/);
    await page.evaluate(request => MediaLibrary.handleBilibiliCollection({ requestId: request.requestId, videos: [{ bvid: 'BV1B7411m7LV', page: 1, title: '过期内容' }] }), request);
    assert.doesNotMatch(await page.$eval('#bilibiliVideoList', e => e.textContent), /过期内容/);
    await page.click('.bilibili-video-card');
    const next = await page.evaluate(() => window.sent.at(-1));
    await page.evaluate(request => MediaLibrary.handleBilibiliCollection({ requestId: request.requestId, error: '列表不可访问' }), next);
    assert.match(await page.$eval('#bilibiliVideoList', e => e.textContent), /列表不可访问/);
    await page.click('#bilibiliVideoList > button');
    assert.equal((await page.evaluate(() => window.sent)).length, 3);
    await page.evaluate(() => MediaLibrary.selectShareFolder('bilibili', ''));
    assert.match(await page.$eval('#bilibiliVideoList', e => e.textContent), /收藏列表 · 收藏/);
});

test('搜索结果支持加入当前分类和选择媒体库下载', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`<div class="media-library-container">${$('.media-library-container').first().html()}</div>`);
    await page.addScriptTag({ path: path.join(root, 'js/upload.js') });
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.sent = []; window.showToast = () => {};
        window.WebSocketManager = { ws: { readyState: WebSocket.OPEN, send: x => window.sent.push(JSON.parse(x)) } };
        MediaLibrary.libraries = [{ id: 'a', name: '本地一', type: 'local', isLocal: true }, { id: 'b', name: '本地二', type: 'local', isLocal: true }];
        MediaLibrary.selectedShareFolder.bilibili = 'folder';
        window.fetch = async (url, options) => {
            if (url.startsWith('/api/bilibili/search')) return { ok: true, json: async () => ({ status: 'success', page: 1, totalPages: 2, videos: [{ url: 'https://www.bilibili.com/video/BV1B7411m7LV', title: '搜索结果', author: 'UP' }] }) };
            window.request = JSON.parse(options.body); return { ok: true, json: async () => ({ status: 'success', job: { status: 'running' } }) };
        };
        MediaLibrary.activeTab = 'bilibili'; MediaLibrary.renderTabs();
    });
    await page.type('#bilibiliSearchInput', '教学');
    await page.click('#bilibiliSearchBar button');
    await page.waitForFunction(() => document.querySelector('#bilibiliVideoList')?.textContent.includes('搜索结果'));
    await page.click('.bilibili-video-actions button:nth-child(2)');
    const sent = await page.evaluate(() => window.sent);
    assert.equal(sent[0].type, 'bilibiliListAdd'); assert.equal(sent[1].folderId, 'folder');
    await page.click('.bilibili-video-actions button:nth-child(3)');
    await page.select('select[aria-label="目标本地媒体库"]', 'b');
    await page.click('.dialog-footer .btn-confirm');
    assert.equal((await page.evaluate(() => window.request)).targetId, 'b');
    assert.match(await page.$eval('#bilibiliDownloadStatus', el => el.textContent), /正在下载/);
});
