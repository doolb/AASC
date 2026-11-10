'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

test('添加媒体库时可选择已运行的任务媒体源', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage(); await page.setContent('<body></body>');
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.showToast = () => {};
        window.fetch = async (url, options) => {
            if (url === '/api/media-library-providers') return { ok: true, json: async () => ({ status: 'success', providers: [{ id: 'web-manifest', name: '网页 JSON 媒体清单' }] }) };
            window.sentConfig = JSON.parse(options.body);
            return { ok: true, json: async () => ({ status: 'success' }) };
        };
        MediaLibrary.loadLibraries = async () => {}; MediaLibrary.render = () => {};
        MediaLibrary.showAddLibraryDialog();
    });
    await page.select('#libType', 'task');
    await page.waitForFunction(() => document.querySelector('#libTaskProvider')?.value === 'web-manifest');
    await page.type('#libName', '示例'); await page.type('#libTaskUrl', 'https://example.test/list.json');
    await page.click('.library-modal-footer .btn-save');
    const config = await page.evaluate(() => window.sentConfig);
    assert.equal(config.type, 'task'); assert.equal(config.providerId, 'web-manifest');
    assert.equal(config.url, 'https://example.test/list.json'); assert.equal(config.readonly, true);
});

test('本地媒体服务任务创建实例时默认选择服务模式', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<div id="taskTabNew"></div>');
    await page.addScriptTag({ path: path.join(root, 'js/task-panel.js') });
    await page.evaluate(() => { TaskPanel._showEditView({ taskName: 'local-only.web-manifest', mode: 'service', entryFile: 'task.js', files: [], instances: [] }); });
    assert.equal(await page.$eval('#editModeGroup .active', node => node.dataset.value), 'service');
    assert.equal(await page.$eval('#editEntryFile', node => node.value), 'task.js');
});
