'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium'].find(candidate => candidate && fs.existsSync(candidate));

test('两端模型快选按 Provider 回显独立档位并只发送选择消息', { skip: !chrome }, async t => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><html><body><div id="control"></div><div id="display"></div></body></html>');
    await page.addScriptTag({ path: path.join(root, 'js/chat-model-tier-picker.js') });
    await page.evaluate(() => {
        window.sent = [];
        const send = message => { window.sent.push(message); return true; };
        window.controlPicker = window.ChatModelTierPicker.create({ host: document.getElementById('control'), prefix: 'control', send });
        window.displayPicker = window.ChatModelTierPicker.create({ host: document.getElementById('display'), prefix: 'display', send });
        for (const picker of [window.controlPicker, window.displayPicker]) picker.setConnected(true);
        const message = { type: 'chatModelTierConfig', selection: {
            providerId: 'qwen', tiersByProvider: { qwen: 'flash', doubaochat: 'mini' }
        }, providers: [{ id: 'qwen', name: 'Qwen' }, { id: 'doubaochat', name: '豆包' }] };
        for (const picker of [window.controlPicker, window.displayPicker]) picker.handleMessage(message);
    });
    await page.click('#controlChatModelTierToggle');
    await page.click('#displayChatModelTierToggle');
    assert.equal(await page.$eval('#controlChatModelTierPanel [data-provider]', node => node.value), 'qwen');
    assert.equal(await page.$eval('#displayChatModelTierPanel .chat-model-tier-levels .is-selected', node => node.textContent), '普通');
    await page.select('#controlChatModelTierPanel [data-provider]', 'doubaochat');
    assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), {
        type: 'setChatModelTierSelection', providerId: 'doubaochat', tier: 'mini'
    });
    assert.equal(await page.$eval('#controlChatModelTierPanel [data-provider]', node => node.value), 'qwen');
    await page.evaluate(() => {
        const message = { type: 'chatModelTierConfig', selection: {
            providerId: 'doubaochat', tiersByProvider: { qwen: 'flash', doubaochat: 'mini' }
        }, providers: [{ id: 'qwen', name: 'Qwen' }, { id: 'doubaochat', name: '豆包' }] };
        for (const picker of [window.controlPicker, window.displayPicker]) picker.handleMessage(message);
    });
    assert.equal(await page.$eval('#displayChatModelTierPanel [data-provider]', node => node.value), 'doubaochat');
    assert.equal(await page.$eval('#controlChatModelTierPanel .chat-model-tier-levels .is-selected', node => node.textContent), '轻量');
    assert.equal(await page.$eval('#controlChatModelTierPanel [data-login]', node => node.disabled), true);
    assert.deepEqual(errors, []);
});

test('实际显示页 390px 视口内模型面板完整可见', { skip: !chrome }, async t => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 740 });
    const document = cheerio.load(fs.readFileSync(path.join(root, 'display.html'), 'utf8'));
    document('script,link').remove();
    document('head').append('<style>' + ['theme.css', 'display.css', 'display-mmd.css', 'chat-model-tier-picker.css']
        .map(file => fs.readFileSync(path.join(root, 'css', file), 'utf8')).join('\n') + '</style>');
    await page.setContent(document.html());
    await page.addScriptTag({ path: path.join(root, 'js/chat-model-tier-picker.js') });
    await page.evaluate(() => {
        document.querySelector('.display-stage-lighting-control').hidden = false;
        window.ChatModelTierPicker.create({ host: document.querySelector('.display-stage-lighting-control'),
            prefix: 'display', send: () => true });
    });
    await page.click('#displayChatModelTierToggle');
    const bounds = await page.$eval('#displayChatModelTierPanel', element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= 390 && bounds.bottom <= 740,
        JSON.stringify(bounds));
});
