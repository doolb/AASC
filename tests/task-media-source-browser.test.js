'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const express = require('express');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
const { TaskMediaDownloadIndex } = require('../src/apps/server/modules/media/task-media-download-index');
const { registerTaskMediaRoutes } = require('../src/apps/server/modules/media/task-media-routes');

test('任务源控制端经真实路由浏览、播放、下载并处理停止和过期响应', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'task-ui-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const registry = new TaskMediaProviderRegistry();
    let seenProxy = '', selectedProxy = 'http://proxy-one';
    const entry = { id: 'video', title: '首页视频', mediaType: 'video', url: 'video' };
    const unregister = registry.register('task', { id: 'demo', name: '测试来源', features: ['home', 'search', 'resolveLink', 'related', 'stream', 'download'], create: config => ({
        list: async () => [], getFile: async () => ({}), getFileStream: async () => ({}),
        home: async ({ page = 1 } = {}) => { seenProxy = config.proxyUrl; return { page: Number(page), totalPages: 2, items: [{ ...entry, title: Number(page) === 2 ? '第二页视频' : entry.title }, { id: 'hls', title: 'HLS 视频', mediaType: 'video', playable: false, playbackMessage: 'HLS 视频请先下载' }, { id: 'collection', title: '合集', mediaType: 'collection', url: 'collection' }, { id: 'no-download', title: '不可下载合集', mediaType: 'collection', url: 'no-download', downloadable: false }, { id: 'file:book.epub', title: '电子书', mediaType: 'text', playable: false, playbackMessage: '该格式暂不支持播放' }, { id: 'file:book.pdf', title: 'PDF 书', mediaType: 'text', playable: false, playbackMessage: '该格式暂不支持播放' }] }; },
        search: async ({ keyword, page = 1 }) => { if (keyword === 'slow') await new Promise(resolve => setTimeout(resolve, 300)); return { page: Number(page), totalPages: 2, items: [{ ...entry, title: `${keyword} 第${page}页` }] }; },
        resolveLink: async ({ url }) => ({ items: [{ ...entry, title: `解析 ${url}` }] }),
        related: async () => ({ items: [{ ...entry, id: 'related', title: '相关推荐视频' }] }),
        getStream: async () => ({ statusCode: 200, stream: Readable.from(['data']), headers: { 'content-type': 'video/mp4' } })
    }) });
    const manager = new MediaLibraryManager({ configPath: path.join(root, 'libraries.json'), taskMediaProviders: registry, getProxyUrl: () => selectedProxy });
    const getTarget = id => { if (id !== 'local') throw Error('bad target'); return { basePath: root }; };
    const index = new TaskMediaDownloadIndex({ indexPath: path.join(root, 'index.json'), getTarget });
    const app = express(); app.use(express.json());
    let base = '', routeBase = ''; registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl: () => routeBase || base });
    const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const $ = cheerio.load(fs.readFileSync(path.join(publicDir, 'upload.html'), 'utf8'));
    app.get('/', (req, res) => res.send(`<link rel="stylesheet" href="/media-library.css"><div class="media-library-container">${$('.media-library-container').first().html()}</div><script src="/media-library.js"></script>`));
    app.get('/media-library.js', (req, res) => res.sendFile(path.join(publicDir, 'js/media-library.js')));
    app.get('/media-library.css', (req, res) => res.sendFile(path.join(publicDir, 'css/media-library.css')));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); t.after(() => browser.close());
    const page = await browser.newPage(); await page.goto(base);
    await page.evaluate(async () => {
        window.messages = []; window.showToast = (message, kind) => messages.push({ message, kind });
        window.WebSocketManager = { send: () => {}, sendMedia: data => { window.played = data; } };
        MediaLibrary.libraries = [{ id: 'local', sourceLibraryId: 'local', type: 'local', isLocal: true }];
        MediaLibrary.loadLibraries = async () => {}; MediaLibrary.refreshTaskMediaSources = async () => {};
        MediaLibrary.refreshQuarkDirectoryDownload = async () => {}; MediaLibrary.setupDragDrop = () => {}; MediaLibrary.render = () => {};
        await MediaLibrary.init();
        MediaLibrary.handleWebProxyConfig({ webProxies: [{ id: 'proxy1', name: '代理一', url: 'http://proxy-one' }], providerProxy: { demo: 'proxy1' } });
        MediaLibrary.handleTaskMediaSources({ providers: [{ id: 'demo', name: '测试来源', libraryId: 'task-auto:demo', features: ['home', 'search', 'resolveLink', 'related', 'stream', 'download'] }] });
    });
    await page.click('[data-task-media-source="demo"]');
    await page.waitForFunction(() => document.querySelector('#taskMediaSourceList').textContent.includes('首页视频'));
    assert.equal(seenProxy, selectedProxy);
    await page.evaluate(() => [...document.querySelectorAll('.task-source-pagination button')].find(e => e.textContent === '下一页').click());
    await page.waitForFunction(() => document.querySelector('#taskMediaSourceList').textContent.includes('第二页视频'));
    await page.evaluate(() => [...document.querySelectorAll('.task-source-pagination button')].find(e => e.textContent === '上一页').click());
    await page.waitForFunction(() => document.querySelector('#taskMediaSourceList').textContent.includes('首页视频'));
    const hls = await page.$$eval('#taskMediaSourceList .bilibili-video-card', cards => { const card = cards.find(node => node.textContent.includes('HLS 视频')); return [...card.querySelectorAll('button')].map(button => ({ text: button.textContent, disabled: button.disabled })); });
    assert.deepEqual(hls, [{ text: '加入', disabled: false }, { text: 'HLS 视频请先下载', disabled: true }, { text: '下载', disabled: false }]);
    const cards = await page.$$eval('#taskMediaSourceList .bilibili-video-card', nodes => nodes.map(node => ({ text: node.textContent, buttons: [...node.querySelectorAll('button')].map(button => button.textContent) })));
    assert.ok(cards.find(card => card.text.includes('不可下载合集')).buttons.includes('打开'));
    assert.equal(cards.find(card => card.text.includes('不可下载合集')).buttons.includes('下载'), false);
    assert.ok(cards.find(card => card.text.includes('合集') && !card.text.includes('不可下载')).buttons.includes('下载'));
    for (const name of ['电子书', 'PDF 书']) {
        const buttons = await page.$$eval('#taskMediaSourceList .bilibili-video-card', (nodes, title) => [...nodes.find(node => node.textContent.includes(title)).querySelectorAll('button')].map(button => ({ text: button.textContent, disabled: button.disabled })), name);
        assert.deepEqual(buttons, [{ text: '加入', disabled: false }, { text: '该格式暂不支持播放', disabled: true }, { text: '下载', disabled: false }]);
    }
    assert.equal(await page.$('.media-library-tabs [data-task-media-proxy="demo"]'), null);
    assert.equal(await page.evaluate(() => MediaLibrary.webProxyConfig.providerProxy.demo), 'proxy1');
    await page.evaluate(() => [...document.querySelectorAll('#taskMediaSourceList button')].find(e => e.textContent === '播放').click());
    await page.waitForFunction(() => window.played && !document.querySelector('#taskSourceRelated').hidden);
    assert.match(await page.evaluate(() => played.url), /\/stream\/video$/);
    assert.equal(await (await fetch(await page.evaluate(() => played.url))).text(), 'data');
    await page.evaluate(() => { MediaLibrary.libraries = []; [...document.querySelectorAll('#taskMediaSourceList button')].find(e => e.textContent === '下载').click(); });
    assert.ok(await page.evaluate(() => messages.some(e => e.message.includes('可写本地媒体库'))));
    await page.evaluate(() => { MediaLibrary.libraries = [{ id: 'local', sourceLibraryId: 'local', type: 'local', isLocal: true }]; });
    await page.evaluate(() => [...document.querySelectorAll('#taskMediaSourceList button')].find(e => e.textContent === '下载').click());
    await page.waitForFunction(() => [...document.querySelectorAll('#taskMediaSourceList button')].some(e => e.textContent === '已下载' && e.disabled));
    assert.equal(await fsp.readFile(path.join(root, '测试来源', '首页视频.mp4'), 'utf8'), 'data');
    await page.evaluate(() => [...document.querySelectorAll('#taskMediaSourceList button')].find(e => e.textContent === '打开').click());
    await page.waitForFunction(() => document.querySelector('#taskMediaSourceList').textContent.includes('解析 collection'));
    await page.type('#taskSourceSearchInput', 'slow'); await page.click('#taskSourceSearchBtn');
    await page.evaluate(() => { document.querySelector('#taskSourceSearchInput').value = 'fast'; }); await page.click('#taskSourceSearchBtn');
    await page.waitForFunction(() => document.querySelector('#taskMediaSourceList').textContent.includes('fast'));
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.match(await page.$eval('#taskMediaSourceList', e => e.textContent), /fast/);
    await page.evaluate(() => [...document.querySelectorAll('.task-source-pagination button')].find(e => e.textContent === '下一页').click());
    await page.waitForFunction(() => document.querySelector('#taskMediaSourceList').textContent.includes('fast 第2页'));
    await page.type('#taskSourceLinkInput', 'abc'); await page.click('#taskSourceLinkBtn');
    await page.waitForFunction(() => document.querySelector('#taskMediaSourceList').textContent.includes('解析 abc'));
    await page.evaluate(() => { document.querySelector('#taskSourceSearchInput').value = 'slow'; });
    await page.click('#taskSourceSearchBtn');
    await page.evaluate(() => MediaLibrary.handleTaskMediaSources({ providers: [{ id: 'demo', name: '更新来源', libraryId: 'task-auto:demo', features: ['home'] }] }));
    await page.waitForFunction(() => document.querySelector('#taskMediaSourceList').textContent.includes('首页视频'));
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.match(await page.$eval('#taskMediaSourceList', e => e.textContent), /首页视频/);
    assert.equal(await page.$eval('#taskSourceSearchBtn', e => e.hidden), true);
    assert.equal(await page.$eval('#taskSourceLinkBtn', e => e.hidden), true);
    assert.equal(await page.$eval('#taskSourceTitle', e => e.textContent), '更新来源');
    assert.equal(await page.$$eval('#taskMediaSourceList button', buttons => buttons.some(e => e.textContent === '下载')), false);
    const safeError = '番茄下载或读取进行中，暂不能切换代理';
    const removeTomato = registry.register('tomato-task', { id: 'tomato', name: '番茄', features: ['home'], create: () => ({
        list: async () => [], getFile: async () => ({}), getFileStream: async () => ({}),
        home: async () => { throw new Error(safeError); }
    }) });
    await page.evaluate(() => MediaLibrary.handleTaskMediaSources({ providers: [{ id: 'tomato', name: '番茄', libraryId: 'task-auto:tomato', features: ['home'] }] }));
    await page.click('[data-task-media-source="tomato"]');
    await page.waitForFunction(message => messages.some(entry => entry.message.includes(message)), {}, safeError);
    removeTomato();
    await page.evaluate(() => MediaLibrary.handleTaskMediaSources({ providers: [{ id: 'demo', name: '更新来源', libraryId: 'task-auto:demo', features: ['home'] }] }));
    await page.click('[data-task-media-source="demo"]');
    // Pixiv 缩略图由真实同源路由返回，浏览器不会直接请求 CDN。
    routeBase = 'http://192.0.2.1:12345';
    const { createPixivProvider } = require('../res/tasks/overseas-media/providers/pixiv');
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const pixivCalls = [];
    const removePixiv = registry.register('pixiv-task', { id: 'pixiv', name: 'Pixiv', features: ['home', 'stream'], create: config => createPixivProvider(config, { cookie: 'secret=1', httpGet: async (cfg, url, opts) => {
        pixivCalls.push({ url, cookie: opts.headers.Cookie, referer: opts.headers.Referer, proxy: cfg.proxyUrl });
        if (url.includes('ranking.php')) return { data: { contents: [{ illust_id: '123', title: '作品', url: 'https://i.pximg.net/cover.png' }] } };
        if (url.includes('/ajax/illust/')) return { data: { body: { urls: { small: 'https://i.pximg.net/cover.png' } } } };
        return { status: 200, headers: { 'content-type': 'image/png' }, data: Readable.from([pixel]) };
    } }) });
    await page.evaluate(() => MediaLibrary.handleTaskMediaSources({ providers: [{ id: 'pixiv', name: 'Pixiv', libraryId: 'task-auto:pixiv', features: ['home', 'stream'] }] }));
    await page.click('[data-task-media-source="pixiv"]');
    await page.waitForFunction(() => { const img = document.querySelector('#taskMediaSourceList img'); return img && img.complete && img.naturalWidth === 1; });
    assert.equal(await page.$eval('#taskMediaSourceList img', img => img.getAttribute('src')), '/api/task-media-sources/pixiv/cover/pixiv%3A123');
    assert.equal(await page.$eval('#taskMediaSourceList img', img => new URL(img.src).origin), base);
    const cdn = pixivCalls.find(call => call.url.startsWith('https://i.pximg.net/')); assert.equal(cdn.cookie, undefined); assert.equal(cdn.referer, 'https://www.pixiv.net/'); assert.equal(cdn.proxy, selectedProxy);
    removePixiv(); routeBase = '';
    await page.evaluate(() => MediaLibrary.handleTaskMediaSources({ providers: [{ id: 'demo', name: '更新来源', libraryId: 'task-auto:demo', features: ['home'] }] }));
    await page.click('[data-task-media-source="demo"]');
    unregister(); await page.click('#taskSourceHomeBtn');
    await page.waitForFunction(() => messages.some(e => e.message.includes('首页失败')));
    await page.evaluate(() => MediaLibrary.handleTaskMediaSources({ providers: [] }));
    assert.equal(await page.$eval('#taskMediaSourceBar', e => getComputedStyle(e).display), 'none');
    assert.equal(await page.$eval('#taskMediaSourceList', e => getComputedStyle(e).display), 'none');
    assert.equal(await page.evaluate(() => MediaLibrary.activeTab), 'libraries');
});
