'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const html = fs.readFileSync(path.join(__dirname, '../src/apps/server/boot/offline-launcher/ui/index.html'), 'utf8');

async function fixture(t, options = {}) {
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage(); await page.setViewport({ width: 798, height: 388 });
    const errors = []; page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []));
    await page.setContent(html);
    await page.evaluate(options => {
        window.requests = []; window.mode = options.mode || 'preparing'; window.eligible = options.eligible || false;
        window.emit = value => window.dispatchEvent(new CustomEvent('offline-launcher', { detail: value }));
        const models = ['tts', 'sensevoice', 'llm'].map(modelId => ({ modelId, totalBytes: 1048576 }));
        const catalog = { models, groups: models.map((model, i) => ({ id: model.modelId, title: model.modelId, modelIds: [model.modelId], defaultSelected: i < 2 })) };
        window.OfflineLauncher = { postMessage(raw) {
            const message = JSON.parse(raw); window.requests.push(message); let result = {};
            const reply = (result, error) => queueMicrotask(() => window.emit({ type: 'ui.result', requestId: message.requestId, result, error }));
            if (message.type === 'models.catalog') result = catalog;
            if (message.type === 'state.get') result = { status: window.mode, phase: window.mode === 'preparing' ? 'awaiting_confirmation' : '', modelStates: models, progress: window.currentProgress };
            if (message.type === 'bootstrap.preview') result = { baseUrl: 'http://lan.local/', downloadBytes: 50949299, signedManifest: 'signed' };
            if (message.type === 'bootstrap.install') { window.mode = 'installing'; window.finishInstall = () => { window.mode = 'ready'; window.emit({ type: 'startup.status', payload: { status: 'ready' } }); reply({ applied: true }); }; return; }
            if (message.type === 'ui.firstRun') result = { show: window.eligible, token: 'first-token' };
            if (message.type === 'ui.firstRunShown') {
                const r = document.querySelector('#first').getBoundingClientRect();
                message.geometry = { top: r.top, bottom: r.bottom, height: innerHeight, visibility: document.visibilityState };
                window.eligible = false;
            }
            if (message.type === 'models.prepareGroup') { window.finishModels = () => reply({}); window.cancelModels = () => reply(null, '已取消模型准备'); return; }
            if (message.type === 'models.cancel') window.cancelModels?.();
            reply(result);
        } };
    }, options);
    return page;
}

async function init(page, payload = {}) { await page.evaluate(payload => window.emit({ type: 'ui.init', payload: { firstRunQuery: true, ...payload } }), payload); }

test('自动服务弹窗直接下载，显示分阶段，健康后自动收起', async t => {
    const page = await fixture(t); await init(page, { automatic: true });
    await page.waitForFunction(() => !document.querySelector('#previewResult').hidden);
    assert.equal(await page.evaluate(() => window.requests.filter(row => row.type === 'bootstrap.install').length), 1);
    assert.match(await page.$eval('#source', n => n.textContent), /49 MiB.*\n来源：http:\/\/lan.local/);
    await page.waitForFunction(() => window.requests.some(row => row.type === 'bootstrap.install'));
    await page.evaluate(() => window.emit({ type: 'startup.status', payload: { status: 'installing' } }));
    for (const [phase, title] of [['extracting', '解压'], ['verifying', '校验'], ['merging', '合并']]) {
        await page.evaluate(phase => { window.currentProgress = { phase, detail: 'common', indeterminate: true, elapsedSeconds: 3 }; window.emit({ type: 'update.progress', payload: window.currentProgress }); }, phase);
        assert.match(await page.$eval('#message', n => n.textContent), new RegExp(title));
        assert.equal(await page.$eval('#progress', n => n.hasAttribute('value')), false);
        await page.evaluate(() => document.querySelector('#refresh').click());
        await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
        assert.match(await page.$eval('#message', n => n.textContent), new RegExp(title));
    }
    await page.evaluate(() => window.finishInstall());
    await page.waitForFunction(() => window.requests.some(row => row.type === 'native.openDisplay'));
    assert.equal(await page.evaluate(() => window.requests.find(row => row.type === 'native.openDisplay').payload.deferred), false);
    assert.equal(await page.$eval('#progress', n => n.hidden), true);
});

test('首包不提供取消，返回键不取消或收起安装', async t => {
    const page = await fixture(t); await init(page, { automatic: true });
    await page.waitForFunction(() => window.requests.some(row => row.type === 'bootstrap.install'));
    assert.equal(await page.$eval('#cancelInstall', n => getComputedStyle(n).display), 'none');
    await page.evaluate(() => window.dispatchEvent(new Event('launcher-back')));
    assert.equal(await page.evaluate(() => window.requests.some(row => row.type === 'bootstrap.cancel' || row.type === 'native.openDisplay')), false);
});

test('388px横屏模型确认可见后消费，只列语音两组，稍后关闭', async t => {
    const page = await fixture(t, { mode: 'ready', eligible: true }); await init(page, { automatic: true });
    await page.waitForFunction(() => window.requests.some(row => row.type === 'ui.firstRunShown'));
    await page.setViewport({ width: 568, height: 273 });
    const proof = await page.evaluate(() => window.requests.find(row => row.type === 'ui.firstRunShown'));
    for (const id of ['downloadModels', 'later']) { const rect = await page.$eval('#' + id, n => ({ top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom, viewport: innerHeight })); assert.ok(rect.top >= 0 && rect.bottom <= rect.viewport, JSON.stringify({ id, ...rect })); }
    assert.equal(proof.payload.visible, true); assert.equal(proof.geometry.visibility, 'visible');
    assert.ok(proof.geometry.top >= -1 && proof.geometry.top < proof.geometry.height);
    assert.equal(await page.$$eval('#models input', nodes => nodes.length), 2);
    assert.equal(await page.$$eval('#models input:checked', nodes => nodes.length), 2);
    assert.equal(await page.evaluate(() => window.requests.some(row => row.type === 'models.prepareGroup')), false);
    await page.click('#later'); await page.waitForFunction(() => window.requests.some(row => row.type === 'native.openDisplay'));
});

test('屏外或后台提示不消费，回前台且滚入视口后才消费', async t => {
    const page = await fixture(t, { mode: 'ready' });
    await page.evaluate(() => {
        const first = document.querySelector('#first'); const spacer = document.createElement('div'); spacer.id = 'spacer'; spacer.style.height = '900px'; first.before(spacer);
        first.scrollIntoView = () => {};
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.testVisibility || 'visible' });
    });
    await init(page, { firstRunToken: 'screen-token' });
    await page.waitForFunction(() => !document.querySelector('#first').hidden);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await page.evaluate(() => window.requests.some(row => row.type === 'ui.firstRunShown')), false);
    await page.evaluate(() => { window.testVisibility = 'hidden'; document.querySelector('#spacer').remove(); window.dispatchEvent(new Event('scroll')); });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await page.evaluate(() => window.requests.some(row => row.type === 'ui.firstRunShown')), false);
    await page.evaluate(() => { window.testVisibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => window.requests.some(row => row.type === 'ui.firstRunShown'));
});

test('模型确认后为可取消进度弹窗，完成后收起；返回键取消', async t => {
    const page = await fixture(t, { mode: 'ready', eligible: true }); await init(page, { automatic: true });
    await page.waitForFunction(() => window.requests.some(row => row.type === 'ui.firstRunShown'));
    await page.click('#downloadModels'); await page.waitForFunction(() => window.requests.some(row => row.type === 'models.prepareGroup'));
    assert.equal(await page.evaluate(() => window.requests.some(row => row.type === 'native.openDisplay')), false);
    assert.equal(await page.$eval('body', n => n.classList.contains('model-preparing')), true);
    await page.evaluate(() => window.finishModels()); await page.waitForFunction(() => window.requests.some(row => row.type === 'native.openDisplay'));
    const cancelled = await fixture(t, { mode: 'ready', eligible: true }); await init(cancelled, { automatic: true });
    await cancelled.waitForFunction(() => window.requests.some(row => row.type === 'ui.firstRunShown'));
    await cancelled.click('#downloadModels');
    await cancelled.waitForFunction(() => window.requests.some(row => row.type === 'models.prepareGroup'));
    await cancelled.evaluate(() => window.dispatchEvent(new Event('launcher-back')));
    await cancelled.waitForFunction(() => window.requests.some(row => row.type === 'models.cancel') && window.requests.some(row => row.type === 'native.openDisplay'));
});

test('自更新重载恢复首包样式，只读握手恢复且有效阶段清旧错误', async t => {
    const page = await fixture(t, { mode: 'installing' });
    await page.evaluate(() => {
        const original = window.OfflineLauncher.postMessage; let rejected = false;
        window.OfflineLauncher.postMessage = raw => {
            const r = JSON.parse(raw);
            if (!rejected && r.type === 'models.catalog') { rejected = true; window.emit({ type: 'ui.result', requestId: r.requestId, error: '启动器暂不可用' }); return; }
            original(raw);
        };
    });
    await init(page, { automatic: true });
    await page.waitForFunction(() => document.body.classList.contains('install-dialog'));
    assert.equal(await page.$eval('#cancelInstall', n => getComputedStyle(n).display), 'none');
    assert.equal(await page.evaluate(() => window.requests.some(row => row.type === 'bootstrap.install')), false);
    await page.evaluate(() => { document.querySelector('#error').textContent = '启动器暂不可用'; window.emit({ type: 'update.progress', payload: { phase: 'verifying', indeterminate: true, detail: 'common' } }); });
    assert.equal(await page.$eval('#error', n => n.textContent), '');
    await page.evaluate(() => window.emit({ type: 'startup.status', payload: { status: 'ready' } }));
    await page.waitForFunction(() => window.requests.some(row => row.type === 'native.openDisplay'));
});


test('旧min宿主未声明提示查询能力时不调用未知桥命令', async t => {
    const page = await fixture(t, { mode: 'ready', eligible: true }); await init(page, { firstRunQuery: false });
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已就绪'));
    assert.equal(await page.evaluate(() => window.requests.some(row => row.type === 'ui.firstRun')), false);
});
