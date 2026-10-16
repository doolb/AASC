'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

test('本地启动页首装/模型/进度/取消/错误恢复：所有下载等待点击', async t => {
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close()); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 412, height: 860 });
    await page.setContent(fs.readFileSync(path.join(__dirname, '../src/apps/server/boot/offline-launcher/ui/index.html'), 'utf8'));
    await page.evaluate(() => {
        window.requests = []; window.mode = 'preparing'; window.downloadResolve = null; window.rejectCheck = false;
        const model = { modelId: 'tts', totalBytes: 5 * 1048576 };
        const catalog = { models: [model], groups: [{ id: 'voice-tts', title: 'TTS', modelIds: ['tts'], defaultSelected: true }] };
        window.emit = value => window.dispatchEvent(new CustomEvent('offline-launcher', { detail: value }));
        window.OfflineLauncher = { postMessage(raw) {
            const message = JSON.parse(raw); window.requests.push(message);
            let result = {};
            switch (message.type) {
                case 'models.catalog': result = catalog; break;
                case 'state.get': result = { status: window.mode, phase: window.mode === 'ready' ? '' : 'awaiting_confirmation', modelStates: [{ ...model, filesPresent: false, filesReady: false }] }; break;
                case 'bootstrap.preview': result = { baseUrl: 'http://mirror.local/', downloadBytes: 10 * 1048576, signedManifest: 'signed' }; break;
                case 'bootstrap.install': window.mode = 'ready'; result = { applied: true }; break;
                case 'service.check':
                    if (window.rejectCheck) { window.emit({ type: 'ui.result', requestId: message.requestId, error: '镜像暂不可用' }); return; }
                    result = { status: '发现服务更新', hasUpdate: true, downloadBytes: 10, installed: { codeVersion: 1, dependencyVersion: 1 } }; break;
                case 'service.apply': result = { applied: true, status: '更新完成' }; break;
                case 'models.prepareGroup':
                    window.downloadResolve = () => window.emit({ type: 'ui.result', requestId: message.requestId, error: '已取消模型准备' });
                    window.emit({ type: 'model.progress', payload: { modelId: 'tts', progress: 42 } }); return;
                case 'models.cancel': window.downloadResolve?.(); break;
            }
            queueMicrotask(() => window.emit({ type: 'ui.result', requestId: message.requestId, result }));
        } };
        window.emit({ type: 'ui.init', payload: {} });
    });
    await page.waitForFunction(() => !document.querySelector('#bootstrap').hidden);
    assert.equal(await page.evaluate(() => window.requests.some(row => /install|prepareGroup|apply/.test(row.type))), false);
    await page.click('#preview'); await page.waitForFunction(() => !document.querySelector('#previewResult').hidden);
    assert.match(await page.$eval('#source', node => node.textContent), /10 MiB/);
    assert.equal(await page.evaluate(() => window.requests.some(row => row.type === 'bootstrap.install')), false);
    await page.click('#install'); await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已就绪'));
    await page.evaluate(() => window.emit({ type: 'ui.init', payload: { firstRunToken: 'shown-token' } }));
    await page.waitForFunction(() => window.requests.some(row => row.type === 'ui.firstRunShown'));
    assert.equal(await page.$eval('#first', node => node.hidden), false);
    assert.equal(await page.$eval('#models input', node => node.checked), true);
    assert.equal(await page.evaluate(() => window.requests.some(row => row.type === 'models.prepareGroup')), false);
    await page.click('#downloadModels'); await page.waitForFunction(() => document.querySelector('#progress').value === 42);
    await page.click('#cancelModels'); await page.waitForFunction(() => window.requests.some(row => row.type === 'models.cancel'));
    await page.waitForFunction(() => !document.querySelector('#downloadModels').disabled);
    await page.evaluate(() => { window.rejectCheck = true; }); await page.click('#check');
    await page.waitForFunction(() => document.querySelector('#error').textContent.includes('镜像暂不可用'));
    assert.equal(await page.$eval('#check', node => node.disabled), false);
    await page.evaluate(() => { window.rejectCheck = false; }); await page.click('#check');
    await page.waitForFunction(() => !document.querySelector('#apply').hidden);
    await page.click('#apply'); await page.waitForFunction(() => document.querySelector('#apply').hidden);
    await page.screenshot({ path: '/tmp/aasc-launcher-ui.png', fullPage: true });
    assert.deepEqual(errors, []);
});

test('启动页阻断网络资源/嵌入/导航，桥不暴露显示端NativeBridge', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/apps/server/boot/offline-launcher/ui/index.html'), 'utf8');
    assert.match(html, /connect-src 'none'/); assert.match(html, /frame-src 'none'/); assert.match(html, /form-action 'none'/);
    assert.doesNotMatch(html, /<iframe|<script[^>]+src=|fetch\(|XMLHttpRequest|innerHTML|NativeBridge/);
    const native = fs.readFileSync(path.join(__dirname, '../src/apps/android-display/app/src/main/java/com/aasc/display/OfflineLauncherActivity.kt'), 'utf8');
    assert.match(native, /allowFileAccess = false/); assert.match(native, /allowContentAccess = false/);
    assert.match(native, /shouldOverrideUrlLoading[^\n]+true/); assert.match(native, /require\(type in OfflineLauncherProtocol.commands\)/);
    assert.match(native, /OfflineLauncherProtocol.isLocalDocument\(request.url.toString\(\), request.isForMainFrame\)/);
    assert.match(native, /page.loadUrl\(ORIGIN\)/); assert.doesNotMatch(native, /loadDataWithBaseURL/);
});
