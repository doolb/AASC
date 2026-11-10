'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

test('浏览器中切换夸克标签并用分享文字加入已有库和播放', async t => {
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
        window.MediaLibrary.libraries = [
            { id: 'local', type: 'local', name: '本地', isLocal: true },
            { id: 'old', sourceLibraryId: 'old', type: 'quark', name: '旧分享', shareId: 'abcd', isLocal: true }
        ];
        window.MediaLibrary.loadContent = async () => {};
        window.MediaLibrary.showBatchPlayDialog = path => { window.playPath = path; };
        window.MediaLibrary.switchLibrary('local');
    });
    await page.click('#mediaTabQuark');
    assert.equal(await page.$eval('#quarkShareBar', el => getComputedStyle(el).display), 'flex');
    assert.match(await page.$eval('#quarkShareList', el => el.textContent), /旧分享/);
    await page.type('#quarkShareInput', 'https://pan.quark.cn/s/abcd 提取码：1234');
    await page.evaluate(() => window.MediaLibrary.addQuarkShare(true));
    assert.equal(await page.evaluate(() => window.MediaLibrary.currentLibrary.id), 'old');
    assert.equal(await page.evaluate(() => window.playPath), '/');
});

test('夸克和 B 站各自浏览服务端文件夹，移动后链接仅出现在目标文件夹', async t => {
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
        window.sent = [];
        window.WebSocketManager = { ws: { readyState: WebSocket.OPEN, send: msg => window.sent.push(JSON.parse(msg)) } };
        MediaLibrary.libraries = [{ id: 'q1', type: 'quark', name: '云分享', isLocal: true }];
        MediaLibrary.bilibiliVideos = [{ url: 'https://www.bilibili.com/video/BV1B7411m7LV', bvid: 'BV1B7411m7LV', page: 1, title: '动画' }];
        MediaLibrary.handleShareFolders({ folders: { quark: { folders: [{ id: 'qf', name: '电影' }], entries: {} }, bilibili: { folders: [{ id: 'bf', name: '收藏' }], entries: {} } } });
    });
    await page.click('#mediaTabQuark');
    assert.match(await page.$eval('#quarkShareList', el => el.textContent), /云分享/);
    await page.$eval('.share-link-actions button', el => el.click());
    await page.$eval('.share-move-list input[value="qf"]', el => el.click());
    await page.click('.share-move-dialog .btn-confirm');
    assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), { type: 'shareFolderMove', category: 'quark', key: 'q1', folderId: 'qf' });
    await page.evaluate(() => MediaLibrary.handleShareFolders({ folders: { quark: { folders: [{ id: 'qf', name: '电影' }], entries: { q1: 'qf' } }, bilibili: { folders: [{ id: 'bf', name: '收藏' }], entries: {} } } }));
    assert.doesNotMatch(await page.$eval('#quarkShareList', el => el.textContent), /云分享/);
    await page.evaluate(() => MediaLibrary.selectShareFolder('quark', 'qf'));
    assert.match(await page.$eval('#quarkShareList', el => el.textContent), /云分享/);
    await page.click('#mediaTabBilibili');
    await page.$eval('.bilibili-video-actions button:nth-child(3)', el => el.click());
    await page.$eval('.share-move-list input[value="bf"]', el => el.click());
    await page.click('.share-move-dialog .btn-confirm');
    assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), { type: 'shareFolderMove', category: 'bilibili', key: 'https://www.bilibili.com/video/BV1B7411m7LV', folderId: 'bf' });
});

test('移动文件夹弹窗预选当前分类，取消和异常不发送', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<button id="opener">打开</button>');
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.sent = []; window.messages = [];
        window.showToast = (text) => window.messages.push(text);
        window.WebSocketManager = { ws: { readyState: WebSocket.OPEN, send: text => window.sent.push(JSON.parse(text)) } };
        MediaLibrary.shareFolders.bilibili = { folders: [{ id: 'a', name: '<img src=x>' }, { id: 'b', name: '视频' }], entries: { key: 'b' } };
        document.getElementById('opener').onclick = () => MediaLibrary.moveShare('bilibili', 'key');
    });
    await page.click('#opener');
    assert.equal(await page.$eval('.share-move-list input:checked', e => e.value), 'b');
    assert.equal(await page.$$('.share-move-list img').then(nodes => nodes.length), 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.share-move-dialog'), null);
    assert.equal(await page.evaluate(() => window.sent.length), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'opener');
    await page.click('#opener');
    await page.$eval('.share-move-list input[value="a"]', e => e.click());
    await page.evaluate(() => { MediaLibrary.shareFolders.bilibili.folders = [{ id: 'b', name: '视频' }]; });
    await page.click('.share-move-dialog .btn-confirm');
    assert.match(await page.evaluate(() => window.messages.at(-1)), /不存在/);
    assert.equal(await page.evaluate(() => window.sent.length), 0);
    await page.$eval('.share-move-list input[value=""]', e => e.click());
    await page.evaluate(() => { window.WebSocketManager.ws.readyState = WebSocket.CLOSED; });
    await page.click('.share-move-dialog .btn-confirm');
    assert.ok(await page.$('.share-move-dialog'));
    assert.equal(await page.evaluate(() => window.sent.length), 0);
    await page.evaluate(() => { window.WebSocketManager.ws.readyState = WebSocket.OPEN; });
    await page.click('.share-move-dialog .btn-confirm');
    assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), { type: 'shareFolderMove', category: 'bilibili', key: 'key', folderId: '' });
});

test('夸克分享与 B 站视频卡片可复制各自链接', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`<div class="media-library-container">${$('.media-library-container').first().html()}</div>`);
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.showToast = () => {}; window.copied = [];
        document.execCommand = command => { if (command === 'copy') window.copied.push(document.activeElement.value); return true; };
        MediaLibrary.libraries = [{ id: 'q', type: 'quark', name: '分享', shareId: 'abcd', isLocal: true }];
        MediaLibrary.bilibiliVideos = [{ url: 'https://www.bilibili.com/video/BV1B7411m7LV?p=2', bvid: 'BV1B7411m7LV', page: 2, title: '视频' }];
    });
    await page.click('#mediaTabQuark');
    await page.$eval('.share-link-actions button:nth-child(3)', button => button.click());
    await page.click('#mediaTabBilibili');
    await page.$eval('.bilibili-video-actions button:nth-child(4)', button => button.click());
    assert.deepEqual(await page.evaluate(() => window.copied), ['https://pan.quark.cn/s/abcd', 'https://www.bilibili.com/video/BV1B7411m7LV?p=2']);
});
