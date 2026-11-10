'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

test('运行中的任务分别显示顶部页签，搜索结果可复制链接，自测入口在服务器面板', async t => {
  if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
  const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
  const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
  assert.equal($('#panel-servers [onclick="SelfTest.runAllTests()"]').length, 1);
  assert.equal($('.self-test-trigger').length, 0);
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<div class="media-library-container">${$('.media-library-container').first().html()}</div>`);
  await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
  await page.evaluate(() => {
    window.showToast = () => {};
    MediaLibrary.libraries = [{ id: 'task1', name: '红果测试', type: 'task' }, { id: 'local', name: '本地测试', type: 'local' }];
    MediaLibrary.copyShareLink = url => { window.copied = url; };
  });
  await page.evaluate(() => {
    window.fetch = async url => ({ ok: true, json: async () => ({ status: 'success', items: [{ name: '剧集目录', path: '/series', type: 'folder' }] }) });
    MediaLibrary.handleTaskMediaSources({ providers: [{ id: 'hongguo', name: '红果短剧', libraryId: 'task-auto:hongguo' }, { id: 'other', name: '其他来源', libraryId: 'existing' }] });
  });
  assert.equal(await page.$$eval('[data-task-media-source]', nodes => nodes.length), 2);
  assert.equal(await page.$('#taskMediaBar'), null);
  await page.click('[data-task-media-source="hongguo"]');
  await page.waitForFunction(() => document.querySelector('#mediaLibraryContent').textContent.includes('剧集目录'));
  assert.equal(await page.evaluate(() => MediaLibrary.currentLibrary.id), 'task-auto:hongguo');
  await page.evaluate(() => MediaLibrary.handleTaskMediaSources({ providers: [{ id: 'other', name: '其他来源', libraryId: 'existing' }] }));
  assert.equal(await page.$$eval('[data-task-media-source]', nodes => nodes.length), 1);
  assert.equal(await page.evaluate(() => MediaLibrary.activeTab), 'libraries');
  await page.click('#mediaTabBilibili');
  await page.evaluate(() => { MediaLibrary.bilibiliSearch = { keyword: '测试', page: 1, totalPages: 1, videos: [{ title: '视频', url: 'https://www.bilibili.com/video/BV1B7411m7LV' }] }; MediaLibrary.renderBilibiliVideos(); });
  await page.evaluate(() => [...document.querySelectorAll('.bilibili-video-actions button')].find(e => e.textContent === '复制链接').click());
  assert.equal(await page.evaluate(() => window.copied), 'https://www.bilibili.com/video/BV1B7411m7LV');
});
