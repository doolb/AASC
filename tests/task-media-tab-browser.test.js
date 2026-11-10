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
  await page.addStyleTag({ path: path.join(root, 'css/media-library.css') });
  await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
  await page.evaluate(() => {
    window.showToast = () => {};
    MediaLibrary.libraries = [{ id: 'task1', name: '红果测试', type: 'task' }, { id: 'local', name: '本地测试', type: 'local' }];
    MediaLibrary.copyShareLink = url => { window.copied = url; };
  });
  await page.evaluate(() => {
    window.fetch = async url => ({ ok: true, json: async () => ({ status: 'success', items: [{ name: '剧集目录', path: '/series', type: 'folder' }] }) });
    MediaLibrary.handleTaskMediaSources({ providers: [{ id: 'hongguo', name: '红果短剧（网页公开视频）', libraryId: 'task-auto:hongguo' }, { id: 'other', name: '其他来源', libraryId: 'existing' }] });
  });
  assert.equal(await page.$$eval('[data-task-media-source]', nodes => nodes.length), 2);
  assert.equal(await page.$eval('#overseasMediaSection', el => getComputedStyle(el).display), 'none');
  assert.equal(await page.$eval('[data-task-media-source="hongguo"]', el => el.textContent), '红果短剧');
  assert.equal(await page.evaluate(() => MediaLibrary.taskMediaSources.find(source => source.id === 'hongguo').name), '红果短剧（网页公开视频）');
  assert.equal(await page.$eval('#mediaTabQuark', el => Boolean(el.closest('.media-tab-section').querySelector('#domesticMediaTabs'))), true);
  assert.equal(await page.$$eval('[data-region-label]', nodes => nodes.length), 0);
  await page.evaluate(() => MediaLibrary.handleTaskMediaSources({ providers: [
    { id: 'hongguo', name: '红果短剧（网页公开视频）', libraryId: 'task-auto:hongguo' },
    { id: 'other', name: '其他来源', libraryId: 'existing' },
    { id: 'youtube', name: 'YouTube', libraryId: 'task-auto:youtube', region: 'overseas' }
  ] }));
  assert.equal(await page.$eval('#overseasMediaSection', el => getComputedStyle(el).display), 'flex');
  await page.setViewport({ width: 320, height: 800 });
  const layout = await page.evaluate(() => {
    const tabs = document.querySelector('.media-library-tabs');
    const sections = [...tabs.querySelectorAll('.media-tab-section')];
    return { labels: sections.map(section => section.textContent.trim()),
      rows: sections.map(section => Math.round(section.getBoundingClientRect().top)),
      overflow: tabs.scrollWidth > tabs.clientWidth };
  });
  assert.equal(layout.rows.length, 3);
  assert.ok(layout.rows[0] < layout.rows[1] && layout.rows[1] < layout.rows[2]);
  assert.equal(layout.overflow, false);
  assert.equal(await page.$('#taskMediaBar'), null);
  await page.click('[data-task-media-source="hongguo"]');
  await page.waitForFunction(() => document.querySelector('#mediaLibraryContent').textContent.includes('剧集目录'));
  assert.equal(await page.$eval('[data-task-media-source="hongguo"]', el => el.getAttribute('aria-selected')), 'true');
  assert.equal(await page.$eval('#mediaTabLibraries', el => el.getAttribute('aria-selected')), 'false');
  const colors = await page.evaluate(() => [getComputedStyle(document.querySelector('[data-task-media-source="hongguo"]')).backgroundColor, getComputedStyle(document.querySelector('#mediaTabBilibili')).backgroundColor]);
  assert.notEqual(colors[0], colors[1]);
  assert.equal(await page.evaluate(() => MediaLibrary.currentLibrary.id), 'task-auto:hongguo');
  await page.evaluate(() => MediaLibrary.handleTaskMediaSources({ providers: [{ id: 'other', name: '其他来源', libraryId: 'existing' }] }));
  assert.equal(await page.$eval('#overseasMediaSection', el => getComputedStyle(el).display), 'none');
  assert.equal(await page.$$eval('[data-task-media-source]', nodes => nodes.length), 1);
  assert.equal(await page.evaluate(() => MediaLibrary.activeTab), 'libraries');
  await page.click('#mediaTabBilibili');
  assert.equal(await page.$eval('#mediaTabBilibili', el => el.getAttribute('aria-selected')), 'true');
  assert.equal(await page.$eval('#bilibiliProxySelect', el => getComputedStyle(el.closest('label')).display), 'none');
  assert.equal(await page.$eval('#bilibiliVideoBar', el => el.firstElementChild.id), 'bilibiliHomeBtn');
  assert.equal(await page.$eval('#bilibiliHomeBtn', el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; }), true);
  await page.evaluate(() => { MediaLibrary.loadBilibiliHome = () => { window.bilibiliHomeClicked = true; }; });
  await page.click('#bilibiliHomeBtn');
  assert.equal(await page.evaluate(() => window.bilibiliHomeClicked), true);
  await page.evaluate(() => { MediaLibrary.bilibiliSearch = { keyword: '测试', page: 1, totalPages: 1, videos: [{ title: '视频', url: 'https://www.bilibili.com/video/BV1B7411m7LV' }] }; MediaLibrary.renderBilibiliVideos(); });
  await page.evaluate(() => [...document.querySelectorAll('.bilibili-video-actions button')].find(e => e.textContent === '复制链接').click());
  assert.equal(await page.evaluate(() => window.copied), 'https://www.bilibili.com/video/BV1B7411m7LV');
});
