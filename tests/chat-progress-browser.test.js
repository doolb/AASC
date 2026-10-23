'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');

test('两端灰色签名状态即时更新，正文不覆盖状态，完成/失败/清空收尾且隔离旧请求', async t => {
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close()); const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="chatMessages"></div><div id="display"></div>');
    for (const file of ['chat.js', 'display-chat.js', 'websocket.js']) await page.addScriptTag({ path: path.join(root, 'js', file) });
    await page.evaluate(() => {
        window.ChatMarkdown = { render: text => text }; window.showToast = () => {};
        Chat.requestContextUsage = () => {}; Chat.isLoading = true; Chat.activeRequestId = 'sign'; Chat.showStreamingMessage('早');
        DisplayChat.init({ root: document.getElementById('display'), send: () => true });
        DisplayChat.handleServerMessage({ type: 'chatInput', requestId: 'sign', mode: 'group', content: '早' });
        window.statusEvent = { type: 'chatStatus', requestId: 'sign', code: 'doubao_signature_refreshing', message: '正在重新获取豆包签名…' };
        WebSocketManager.handleMessage(statusEvent); DisplayChat.handleServerMessage(statusEvent);
    });
    assert.deepEqual(await page.$$eval('.chat-request-status', nodes => nodes.map(node => node.textContent)),
        ['正在重新获取豆包签名…', '正在重新获取豆包签名…']);
    await page.evaluate(() => {
        const ready = { ...statusEvent, message: '签名已更新，正在重试…' };
        WebSocketManager.handleMessage(ready); DisplayChat.handleServerMessage(ready);
        const text = { type: 'chatChunk', requestId: 'sign', chunk: '早上好。', message: '早上好。' };
        WebSocketManager.handleMessage(text); DisplayChat.handleServerMessage(text);
        const stale = { ...statusEvent, requestId: 'other', message: '错误请求不显示' };
        WebSocketManager.handleMessage(stale); DisplayChat.handleServerMessage(stale);
    });
    assert.equal(await page.$$eval('.chat-request-status', nodes => nodes.length), 2);
    assert.equal(await page.$eval('#streamingContent', node => node.textContent.includes('签名')), false);
    await page.evaluate(() => {
        const final = { type: 'chatResponse', requestId: 'sign', success: true, message: '早上好。', history: [] };
        WebSocketManager.handleMessage(final); DisplayChat.handleServerMessage(final);
        WebSocketManager.handleMessage(statusEvent); DisplayChat.handleServerMessage(statusEvent);
    });
    assert.equal(await page.$$eval('.chat-request-status', nodes => nodes.length), 0);
    await page.evaluate(() => {
        Chat.isLoading = true; Chat.activeRequestId = 'fail'; Chat.showStreamingMessage('早');
        DisplayChat.handleServerMessage({ type: 'chatInput', requestId: 'fail', content: '早' });
        const progress = { ...statusEvent, requestId: 'fail' };
        WebSocketManager.handleMessage(progress); DisplayChat.handleServerMessage(progress);
        const error = { type: 'chatResponse', requestId: 'fail', success: false, error: '签名获取失败' };
        WebSocketManager.handleMessage(error); DisplayChat.handleServerMessage(error);
        Chat.isLoading = true; Chat.activeRequestId = 'clear'; Chat.showStreamingMessage('早');
        WebSocketManager.handleMessage({ ...statusEvent, requestId: 'clear' });
        Chat.abandonStreamingReply(); Chat.handleStatus({ ...statusEvent, requestId: 'clear' });
    });
    assert.equal(await page.$$eval('.chat-request-status', nodes => nodes.length), 0);
    assert.deepEqual(errors, []);
});
