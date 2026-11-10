'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

test('相关推荐首项跟随播放状态、分 P、去重并忽略过期请求', { timeout: 30000 }, async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => request.respond({ status: 200, body: '' }));
    await page.goto('http://aasc.test/');
    await page.setContent('<div id="bilibiliRelated" hidden><div id="bilibiliRelatedList"></div></div><div data-bilibili-video="1" data-bvid="BV1B7411m7LV" data-page="2"><div class="bilibili-video-title">测试视频 · P2</div></div>');
    await page.addScriptTag({ path: path.resolve('src/apps/web-mediacenter/ui/public/js/media-library.js') });
    const parsed = await page.evaluate(() => MediaLibrary.parseBilibiliCurrent('http://aasc.test/api/bilibili/dash/BV1B7411m7LV?p=2'));
    assert.deepEqual({ bvid: parsed.bvid, page: parsed.page }, { bvid: 'BV1B7411m7LV', page: 2 });
    await page.evaluate(() => {
        window.showToast = () => {};
        MediaLibrary.activeTab = 'bilibili';
        MediaLibrary.checkBilibiliDownloaded = () => {};
        window.pending = {};
        window.fetch = url => new Promise((resolve, reject) => { window.pending[url] = { resolve, reject }; });
        MediaLibrary.parseResponse = response => response.json();
        MediaLibrary.setCurrentMedia('https://www.bilibili.com/video/BV1B7411m7LV?p=2');
    });
    assert.match(await page.$eval('#bilibiliRelatedList', e => e.textContent), /正在播放.*测试视频 · P2/s);
    await page.evaluate(() => {
        MediaLibrary.setCurrentMedia('https://www.bilibili.com/video/BV17x411w7KC');
        window.pending['/api/bilibili/related?bvid=BV17x411w7KC'].resolve({ json: async () => ({ videos: [
            { bvid: 'BV17x411w7KC', title: '重复', url: 'https://www.bilibili.com/video/BV17x411w7KC' },
            { bvid: 'BV1B7411m7LV', title: '推荐', url: 'https://www.bilibili.com/video/BV1B7411m7LV' }
        ] }) });
    });
    await page.waitForFunction(() => document.querySelectorAll('#bilibiliRelatedList .bilibili-video-card').length === 2);
    await page.evaluate(() => window.pending['/api/bilibili/related?bvid=BV1B7411m7LV'].resolve({ json: async () => ({ videos: [] }) }));
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 20)));
    const result = await page.$$eval('#bilibiliRelatedList .bilibili-video-card', cards => cards.map(card => ({ text: card.textContent, bvid: card.dataset.bvid })));
    assert.equal(result[0].bvid, 'BV17x411w7KC');
    assert.match(result[0].text, /正在播放/);
    assert.equal(result[1].bvid, 'BV1B7411m7LV');
    await page.evaluate(() => MediaLibrary.setCurrentMedia('https://example.com/unrelated'));
    assert.equal(await page.$eval('#bilibiliRelated', e => e.hidden), true);
    assert.equal(await page.$$eval('#bilibiliRelatedList .bilibili-video-card', cards => cards.length), 0);
    await page.evaluate(() => { MediaLibrary.setCurrentMedia('https://www.bilibili.com/video/BV17x411w7KC'); window.pending['/api/bilibili/related?bvid=BV17x411w7KC'].reject(new Error('offline')); });
    assert.match(await page.$eval('#bilibiliRelatedList', e => e.textContent), /正在播放/);
});
