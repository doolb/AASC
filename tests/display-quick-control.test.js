'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const { normalizeQuickControl } = require('../src/apps/server/modules/media/display-quick-control');
const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('快捷命令只针对已登记的当前显示端并拒绝非法参数', () => {
    assert.deepEqual(normalizeQuickControl({ action: 'playlist', value: 'next', displayId: 'other' }, 'self'), { type: 'playlistControl', displayIds: ['self'], action: 'next' });
    assert.deepEqual(normalizeQuickControl({ action: 'quickPlay', value: ' 电影 ' }, 'self'), { type: 'voiceCommand', displayId: 'self', text: '播放电影' });
    assert.equal(normalizeQuickControl({ action: 'volume', value: 101 }, 'self'), null);
    assert.equal(normalizeQuickControl({ action: 'reload' }, 'self'), null);
    assert.equal(normalizeQuickControl({ action: 'play', value: true }, ''), null);
    assert.deepEqual(normalizeQuickControl({ action: 'textPlayback', value: { action: 'next', playbackId: 'other' } }, 'self').value, { action: 'next' });
    assert.equal(normalizeQuickControl({ action: 'textStyle', value: { fontSize: 'huge' } }, 'self'), null);
});

test('显示端快捷面板操作、状态同步与返回关闭', { skip: !fs.existsSync(chrome), timeout: 30000 }, async t => {
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'display.html'), 'utf8'));
    $('script,link[rel="stylesheet"]').remove();
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 700 });
    await page.setContent($.html());
    await page.addStyleTag({ path: path.join(root, 'css/display-quick-control.css') });
    await page.addScriptTag({ path: path.join(root, 'js/display-quick-control.js') });
    await page.evaluate(() => {
        window.sent = [];
        window.DisplayQuickControl.init({ send: data => { window.sent.push(data); return true; }, snapshot: () => ({ playing: true, text: { state: 'playing', pageIndex: 1, pageTotal: 3 }, playlist: { index: 0, total: 2, paused: false } }) });
        window.DisplayQuickControl.update({ type: 'restoreState', state: { volume: 45, fit: 'cover' } });
    });
    assert.equal(await page.evaluate(() => [...document.getElementById('displayGameChatActions').children].findIndex(x => x.id === 'displayQuickControlToggle') < [...document.getElementById('displayGameChatActions').children].findIndex(x => x.id === 'displayMediaLibraryToggle')), true);
    await page.evaluate(() => document.getElementById('displayQuickControlToggle').click());
    assert.equal(await page.$eval('#quickVolume', e => e.value), '45');
    assert.equal(await page.$eval('#quickTextStatus', e => e.textContent), '第 2/3 页');
    await page.click('#quickPlayToggle');
    await page.click('[data-playlist="next"]');
    await page.type('#quickPlayName', '电影');
    await page.click('#quickPlayForm button');
    const messages = await page.evaluate(() => window.sent);
    assert.deepEqual(messages.map(x => x.action), ['play', 'playlist', 'quickPlay']);
    assert.equal(messages[0].value, false);
    assert.equal(messages[1].value, 'next');
    assert.equal(await page.evaluate(() => window.DisplayQuickControl.handleBack()), true);
    assert.equal(await page.$eval('#displayQuickControlPanel', e => e.hidden), true);
});

test('按名称播放的搜索结果使用显示端可播放的媒体消息', () => {
    // 语音服务拥有常驻定时器，使用独立进程执行并在断言完成后退出。
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        const voice = require('./src/apps/web-mediacenter/modules/voice/voice-command-app-service');
        const sent = [];
        voice.setClients(new Map(), (id, data) => sent.push({ id, data }), () => {});
        voice.setMediaLibrary({ listLibraries: () => [{ id: 'one' }], list: async () => [{ type: 'file', name: '电影.mp4', path: '/电影.mp4', url: '/uploads/movie.mp4', mediaType: 'video' }] });
        voice.handlePlayCommand('播放电影', 'self', { onResult: async () => {} }).then(() => {
            assert.deepEqual(sent, [{ id: 'self', data: { type: 'url', url: '/uploads/movie.mp4', mediaType: 'video', fileName: '电影.mp4' } }]);
            process.exit(0);
        }).catch(error => { console.error(error); process.exit(1); });
    `], { cwd: path.resolve(__dirname, '..'), timeout: 10000 });
});
