'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

test('夸克缓存进度仅显示在对应文件卡片，支持重绘、完成和取消', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<div id="mediaLibraryContent"></div><div id="quarkCacheStatus"><span id="quarkCacheStatusText"></span><progress id="quarkCacheProgress"></progress></div>');
    await page.addStyleTag({ path: path.join(root, 'css/media-library.css') });
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.showToast = () => {};
        MediaLibrary.currentLibrary = { type: 'quark', id: 'q', readonly: true };
        window.items = [
            { path: '/a/same.mp4', name: 'same.mp4', type: 'file', mediaType: 'video', size: 100, url: 'https://server.test/a' },
            { path: '/b/same.mp4', name: 'same.mp4', type: 'file', mediaType: 'video', size: 100, url: 'https://server.test/b' }
        ];
        MediaLibrary.renderFileList(window.items);
        MediaLibrary.handleQuarkCacheProgress({ status: 'progress', phase: 'downloading', received: 51, total: 100, cacheNodeId: 'main-server', cacheLibraryId: 'q', cachePath: '/b/same.mp4' });
    });
    let states = await page.$$eval('.quark-card-cache', els => els.map(el => ({ hidden: el.hidden, text: el.textContent, value: el.querySelector('progress').value })));
    assert.equal(states[0].hidden, true);
    assert.equal(states[1].hidden, false);
    assert.match(states[1].text, /51%/);
    assert.equal(states[1].value, 51);
    await page.evaluate(() => MediaLibrary.renderFileList(window.items));
    assert.match(await page.$eval('.media-library-item:nth-child(2) .quark-card-cache', el => el.textContent), /51%/);
    await page.evaluate(() => MediaLibrary.handleQuarkCacheProgress({ status: 'ready', cacheNodeId: 'main-server', cacheLibraryId: 'q', cachePath: '/b/same.mp4' }));
    assert.match(await page.$eval('.media-library-item:nth-child(2) .quark-card-cache', el => el.textContent), /缓存完成/);
    await page.evaluate(() => MediaLibrary.handleQuarkCacheProgress({ status: 'cancelled', cacheNodeId: 'main-server', cacheLibraryId: 'q', cachePath: '/b/same.mp4' }));
    assert.equal(await page.$eval('.media-library-item:nth-child(2) .quark-card-cache', el => el.hidden), true);
});

test('夸克文件卡片使用媒体库下载按钮并提交文件元数据与远程来源', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<div id="mediaLibraryContent"></div><div id="quarkDirectoryDownloadStatus"></div>');
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    const buttons = await page.evaluate(() => {
        MediaLibrary.currentLibrary = { type: 'quark', id: 'q', sourceLibraryId: 'q', readonly: true };
        MediaLibrary.renderFileList([
            { path: '/目录/视频 1.mp4', name: '视频 1.mp4', type: 'file', mediaType: 'video', size: 10, modifiedTime: '2026-01-01T00:00:00.000Z', url: 'https://server.test/video' },
            { path: '/目录/已存.mp4', name: '已存.mp4', type: 'file', mediaType: 'video', size: 20, downloaded: true, url: 'https://server.test/video2' }
        ]);
        return [...document.querySelectorAll('.media-library-item .btn-download')].map(button => ({ tag: button.tagName, text: button.textContent, disabled: button.disabled, href: button.getAttribute('href') }));
    });
    assert.deepEqual(buttons, [
        { tag: 'BUTTON', text: '下载', disabled: false, href: null },
        { tag: 'BUTTON', text: '已下载', disabled: true, href: null }
    ]);
    await page.evaluate(() => {
        window.showToast = () => {};
        window.fetch = async (url, opts) => { window.request = { url, ...JSON.parse(opts.body) }; return { ok: true, json: async () => ({ status: 'success', job: { status: 'running', completed: 0 } }) }; };
        MediaLibrary.libraries = [{ type: 'local', id: 'b', name: '本地二', isLocal: true }];
        document.querySelectorAll('.media-library-item .btn-download')[0].click();
    });
    await page.click('.dialog-footer .btn-confirm');
    await page.waitForFunction(() => window.request);
    assert.deepEqual(await page.evaluate(() => window.request), {
        url: '/api/quark-file-downloads', nodeId: 'main-server', libraryId: 'q', targetId: 'b',
        path: '/目录/视频 1.mp4', size: 10, modifiedTime: '2026-01-01T00:00:00.000Z'
    });
    // 等待上一次下载弹窗关闭，避免第二次点击命中旧对话框。
    await page.waitForFunction(() => !document.querySelector('.modal-mask'));
    await page.evaluate(() => {
        MediaLibrary.currentLibrary = { type: 'quark', id: 'sub::q', sourceLibraryId: 'q', ownerNodeId: 'sub', remote: true, readonly: true };
        MediaLibrary.renderFileList([{ path: '/远程.mp4', name: '远程.mp4', type: 'file', mediaType: 'video', size: 30, url: 'https://server.test/remote' }]);
        document.querySelector('.media-library-item .btn-download').click();
    });
    await page.click('.dialog-footer .btn-confirm');
    await page.waitForFunction(() => window.request?.path === '/远程.mp4');
    assert.equal(await page.evaluate(() => window.request.nodeId), 'sub');
    assert.equal(await page.evaluate(() => window.request.libraryId), 'q');
});

test('夸克文件夹卡片显示整目录已下载与部分下载数量', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<div id="mediaLibraryContent"></div>');
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    const states = await page.evaluate(() => {
        MediaLibrary.currentLibrary = { type: 'quark', id: 'q', readonly: true };
        MediaLibrary.renderFileList([
            { type: 'folder', path: '/已完成', name: '已完成', downloaded: true },
            { type: 'folder', path: '/部分', name: '部分', downloadedCount: 2 },
            { type: 'folder', path: '/未开始', name: '未开始' }
        ]);
        return [...document.querySelectorAll('.media-library-item.folder .btn-download')].map(button => ({ text: button.textContent, disabled: button.disabled }));
    });
    assert.deepEqual(states, [
        { text: '已下载', disabled: true },
        { text: '已下载 2', disabled: false },
        { text: '下载到媒体库', disabled: false }
    ]);
});

test('夸克目录可选择任意可写本地媒体库，显示下载进度', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<div id="mediaLibraryContent"></div><div id="quarkDirectoryDownloadStatus"></div>');
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.showToast = () => {};
        window.fetch = async (url, opts) => { window.request = { url, ...JSON.parse(opts.body) }; return { ok: true, json: async () => ({ status: 'success', job: { status: 'running', completed: 0 } }) }; };
        MediaLibrary.currentLibrary = { type: 'quark', id: 'q', readonly: true };
        MediaLibrary.libraries = [
            { type: 'local', id: 'a', name: '本地一', isLocal: true },
            { type: 'local', id: 'b', name: '本地二', isLocal: true },
            { type: 'local', id: 'readonly', name: '只读', isLocal: true, readonly: true },
            { type: 'local', id: 'remote', name: '远程', remote: true }
        ];
        MediaLibrary.renderFileList([{ type: 'folder', path: '/影视', name: '影视' }]);
    });
    await page.click('.media-library-item.folder .btn-download');
    assert.equal(await page.$$eval('select[aria-label="目标本地媒体库"] option', xs => xs.length), 2);
    await page.select('select[aria-label="目标本地媒体库"]', 'b');
    await page.click('.dialog-footer .btn-confirm');
    const req = await page.evaluate(() => window.request);
    assert.deepEqual(req, { url: '/api/quark-directory-downloads', nodeId: 'main-server', libraryId: 'q', targetId: 'b', path: '/影视' });
    await page.evaluate(() => MediaLibrary.handleQuarkDirectoryDownload({ status: 'running', completed: 1, skipped: 0, fileName: '电影.mp4', received: 50, total: 100 }));
    assert.match(await page.$eval('#quarkDirectoryDownloadStatus', el => el.textContent), /电影.mp4 50%/);
});
