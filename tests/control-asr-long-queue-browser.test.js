'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

const publicRoot = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium'].find(candidate => candidate && fs.existsSync(candidate));

test('控制端长语音阈值和并发配置经 WS 同步、保存、失败回退与重连恢复', { skip: !chrome, timeout: 30000 }, async () => {
    const $ = cheerio.load(fs.readFileSync(path.join(publicRoot, 'upload.html'), 'utf8'));
    $('script,link,iframe,img,video,audio,source').remove();
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setContent($.html());
        await page.evaluate(() => {
            window.fetch = async () => ({ json: async () => ({ status: 'success', device: 'display', serverEnabled: true }) });
            window.sentAsrConfigs = [];
        });
        await page.addScriptTag({ path: path.join(publicRoot, 'js/tts.js') });
        await page.addScriptTag({ path: path.join(publicRoot, 'js/websocket.js') });
        await page.evaluate(async () => {
            WebSocketManager.ws = { readyState: WebSocket.OPEN, send: raw => window.sentAsrConfigs.push(JSON.parse(raw)) };
            await AsrDevice.init();
        });
        const read = () => page.evaluate(() => ({
            threshold: document.getElementById('asrLongThresholdSeconds').value,
            concurrency: document.getElementById('asrLongConcurrency').value,
            disabled: document.getElementById('asrLongQueueSaveBtn').disabled,
            status: document.getElementById('asrLongQueueStatus').textContent,
            sent: window.sentAsrConfigs.slice()
        }));
        assert.equal((await read()).disabled, true);
        await page.evaluate(() => WebSocketManager.handleMessage({ type: 'asrLongQueueConfig', thresholdSeconds: 12, concurrency: 2 }));
        assert.deepEqual(((await read()).threshold), '12');
        assert.equal((await read()).disabled, false);
        await page.$eval('#asrLongThresholdSeconds', element => { element.value = '15'; });
        await page.$eval('#asrLongConcurrency', element => { element.value = '3'; });
        await page.$eval('#asrLongQueueSaveBtn', element => element.click());
        const saving = await read();
        assert.equal(saving.disabled, true);
        assert.deepEqual(saving.sent.at(-1).type, 'setAsrLongQueueConfig');
        assert.equal(saving.sent.at(-1).thresholdSeconds, 15);
        assert.equal(saving.sent.at(-1).concurrency, 3);
        await page.evaluate(requestId => WebSocketManager.handleMessage({ type: 'asrLongQueueConfig', thresholdSeconds: 12,
            concurrency: 2, requestId, success: false, message: '保存失败' }), saving.sent.at(-1).requestId);
        const failed = await read();
        assert.equal(failed.threshold, '12');
        assert.equal(failed.concurrency, '2');
        assert.equal(failed.disabled, false);
        assert.match(failed.status, /保存失败/);
        await page.evaluate(() => {
            AsrDevice.handleLongQueueDisconnected();
            WebSocketManager.handleMessage({ type: 'asrLongQueueConfig', thresholdSeconds: 20, concurrency: 4 });
        });
        const restored = await read();
        assert.equal(restored.threshold, '20');
        assert.equal(restored.concurrency, '4');
        assert.equal(restored.disabled, false);
    } finally {
        await browser.close();
    }
});
