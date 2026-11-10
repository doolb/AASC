'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

test('下载分类助手与对话框路径预览', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<div id="quarkDirectoryDownloadStatus"></div>');
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.showToast = () => {};
        window.fetch = async (url, options) => {
            window.lastRequest = { url, body: options?.body ? JSON.parse(options.body) : null };
            return { ok: true, json: async () => ({ status: 'success', job: { status: 'running' } }) };
        };
        MediaLibrary.libraries = [{ id: 'local1', name: '上传', type: 'local', readonly: false, isLocal: true }, { id: 'local2', name: '归档', type: 'local', readonly: false, isLocal: true }];
        MediaLibrary.currentLibrary = { id: 'q1', type: 'quark' };
        MediaLibrary.shareFolders.quark.folders = [{ id: 'f1', name: '课程合集' }, { id: 'f2', name: '资料夹' }];
        MediaLibrary.selectedShareFolder.quark = 'f1';
        MediaLibrary.bilibiliCollection = { title: '合集 A' };
    });
    assert.equal(await page.evaluate(() => MediaLibrary.cleanCategoryName(' 课程 / 2026 ')), '课程 _ 2026');
    assert.equal(await page.evaluate(() => MediaLibrary.currentQuarkCategory()), '课程合集');
    assert.equal(await page.evaluate(() => MediaLibrary.currentBilibiliCategory()), '合集 A');
    assert.equal(await page.evaluate(() => MediaLibrary.categoryPreview('上传', '夸克分享', '')), '目标：上传 / 夸克分享 / 未分类');
    await page.evaluate(() => MediaLibrary.showQuarkDirectoryDownloadDialog('/', { id: 'q1', type: 'quark' }));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.dialog-body p')]
        .some(node => node.textContent === '目标：上传 / 夸克分享 / 课程合集')), true);
    await page.select('select', 'local2');
    assert.equal(await page.$eval('.download-target-preview', node => node.textContent), '目标：归档 / 夸克分享 / 课程合集');
    await page.click('.btn-confirm');
    await page.waitForFunction(() => window.lastRequest?.url === '/api/quark-directory-downloads');
    assert.equal(await page.evaluate(() => window.lastRequest.body.category), '课程合集');
    assert.equal(await page.evaluate(() => window.lastRequest.body.targetId), 'local2');
    await page.waitForFunction(() => !document.querySelector('.modal-mask'));
    // 切换夸克分享文件夹后，重新打开对话框，分类预览与请求分类同步变化。
    await page.evaluate(() => {
        MediaLibrary.selectedShareFolder.quark = 'f2';
        MediaLibrary.showQuarkDirectoryDownloadDialog('/', { id: 'q1', type: 'quark' });
    });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.dialog-body p')]
        .some(node => node.textContent === '目标：上传 / 夸克分享 / 资料夹')), true);
    await page.click('.btn-confirm');
    await page.waitForFunction(() => window.lastRequest?.body?.category === '资料夹');
    await page.waitForFunction(() => !document.querySelector('.modal-mask'));
    // B 站对话框同样显示分类预览，分类来自收藏列表标题。
    await page.evaluate(() => MediaLibrary.showBilibiliDownloadDialog('https://www.bilibili.com/video/BV1xx411c7mD', '合集 A'));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.dialog-body p')]
        .some(node => node.textContent === '目标：上传 / B站视频 / 合集 A')), true);
    await page.click('.btn-confirm');
    await page.waitForFunction(() => window.lastRequest?.url === '/api/bilibili/download');
    assert.equal(await page.evaluate(() => window.lastRequest.body.category), '合集 A');
    await page.waitForFunction(() => !document.querySelector('.modal-mask'));
    await page.evaluate(() => MediaLibrary.showQuarkFileDownloadDialog('/课程.mp4'));
    assert.equal(await page.$eval('.download-target-preview', node => node.textContent), '目标：上传 / 夸克分享 / 资料夹');
    await page.click('.btn-confirm');
    await page.waitForFunction(() => window.lastRequest?.url === '/api/quark-file-downloads');
    assert.equal(await page.evaluate(() => window.lastRequest.body.category), '资料夹');
    assert.equal(await page.evaluate(() => {
        MediaLibrary.bilibiliCollection = null;
        MediaLibrary.shareFolders.bilibili.folders = [{ id: 'b1', name: 'B站分类' }];
        MediaLibrary.selectedShareFolder.bilibili = 'b1';
        return MediaLibrary.currentBilibiliCategory();
    }), 'B站分类');
    assert.equal(await page.evaluate(() => {
        MediaLibrary.selectedShareFolder.bilibili = null;
        return MediaLibrary.categoryPreview('上传', 'B站视频', MediaLibrary.currentBilibiliCategory());
    }), '目标：上传 / B站视频 / 未分类');
});
