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
    await page.setContent('<!doctype html><html><body><div id="control"></div><div id="display"></div><div class="theme-preview-dialog"><button class="theme-preview-button active" id="themeSelected">选中</button><button class="theme-preview-button is-unselected" id="themeUnselected">未选中</button></div></body></html>');
    await page.addStyleTag({ path: path.join(root, 'css/theme.css') });
    await page.addStyleTag({ path: path.join(root, 'css/chat-model-tier-picker.css') });
    await page.addScriptTag({ path: path.join(root, 'js/chat-model-tier-picker.js') });
    await page.evaluate(() => {
        window.sent = [];
        const send = message => { window.sent.push(message); return true; };
        window.controlPicker = window.ChatModelTierPicker.create({ host: document.getElementById('control'), prefix: 'control', send });
        window.displayPicker = window.ChatModelTierPicker.create({ host: document.getElementById('display'), prefix: 'display', send });
        for (const picker of [window.controlPicker, window.displayPicker]) picker.setConnected(true);
        const message = { type: 'chatModelTierConfig', selection: {
            providerId: 'qwen', tiersByProvider: { qwen: 'flash', doubaochat: 'mini' },
            modelName: 'Qwen3.7', profileMode: 'llm'
        }, providers: [{ id: 'qwen', name: 'Qwen' }, { id: 'doubaochat', name: '豆包' }] };
        for (const picker of [window.controlPicker, window.displayPicker]) picker.handleMessage(message);
    });
    await page.click('#controlChatModelTierToggle');
    await page.click('#displayChatModelTierToggle');
    assert.equal(await page.$eval('#controlChatModelTierPanel [data-provider]', node => node.value), 'qwen');
    assert.equal(await page.$eval('#displayChatModelTierPanel .chat-model-tier-levels .is-selected', node => node.textContent), '普通');
    assert.equal(await page.$eval('#displayChatModelTierPanel [data-current-model]', node => node.textContent), '当前模型名：Qwen3.7');
    for (const theme of ['dark', 'light']) {
        await page.evaluate(value => {
            document.documentElement.dataset.theme = value;
            document.documentElement.dataset.themeMode = value;
        }, theme);
        const buttonStyles = await page.evaluate(() => {
            const style = selector => {
                const computed = getComputedStyle(document.querySelector(selector));
                return { image: computed.backgroundImage, background: computed.backgroundColor,
                    color: computed.color, border: computed.borderColor, shadow: computed.boxShadow };
            };
            return {
                expectedSelected: style('#themeSelected'), expectedUnselected: style('#themeUnselected'),
                controlSelected: style('#controlChatModelTierPanel .is-selected'),
                controlUnselected: style('#controlChatModelTierPanel .is-unselected'),
                displaySelected: style('#displayChatModelTierPanel .is-selected'),
                displayUnselected: style('#displayChatModelTierPanel .is-unselected'),
                pressed: [...document.querySelectorAll('#displayChatModelTierPanel .chat-model-tier-levels button')]
                    .filter(button => button.getAttribute('aria-pressed') === 'true').length
            };
        });
        assert.equal(buttonStyles.pressed, 1);
        for (const side of ['control', 'display']) {
            assert.deepEqual(buttonStyles[`${side}Selected`], buttonStyles.expectedSelected, `${theme} ${side} selected`);
            assert.deepEqual(buttonStyles[`${side}Unselected`], buttonStyles.expectedUnselected, `${theme} ${side} unselected`);
        }
    }
    await page.select('#controlChatModelTierPanel [data-provider]', 'doubaochat');
    assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), {
        type: 'setChatModelTierSelection', providerId: 'doubaochat', tier: 'mini'
    });
    assert.equal(await page.$eval('#controlChatModelTierPanel [data-provider]', node => node.value), 'qwen');
    await page.evaluate(() => {
        const message = { type: 'chatModelTierConfig', selection: {
            providerId: 'doubaochat', tiersByProvider: { qwen: 'flash', doubaochat: 'mini' },
            modelName: 'doubao', profileMode: 'llm'
        }, providers: [{ id: 'qwen', name: 'Qwen' }, { id: 'doubaochat', name: '豆包' }] };
        for (const picker of [window.controlPicker, window.displayPicker]) picker.handleMessage(message);
    });
    assert.equal(await page.$eval('#displayChatModelTierPanel [data-provider]', node => node.value), 'doubaochat');
    assert.equal(await page.$eval('#controlChatModelTierPanel .chat-model-tier-levels .is-selected', node => node.textContent), '轻量');
    await page.evaluate(() => {
        const message = { type: 'chatModelTierConfig', selection: {
            providerId: 'doubaochat', tiersByProvider: { qwen: 'flash', doubaochat: 'flash' },
            modelName: 'doubao-think', profileMode: 'llm'
        }, providers: [{ id: 'qwen', name: 'Qwen' }, { id: 'doubaochat', name: '豆包' }] };
        for (const picker of [window.controlPicker, window.displayPicker]) picker.handleMessage(message);
    });
    for (const side of ['control', 'display']) {
        assert.equal(await page.$eval(`#${side}ChatModelTierPanel .chat-model-tier-levels .is-selected`, node => node.textContent), '普通');
        assert.equal(await page.$eval(`#${side}ChatModelTierPanel [data-current-model]`, node => node.textContent), '当前模型名：doubao-think');
    }
    await page.evaluate(() => {
        const message = { type: 'chatModelTierConfig', selection: {
            providerId: 'qwen', tiersByProvider: { qwen: 'mini', doubaochat: 'mini' },
            modelName: 'Qwen3.6-Flash', profileMode: 'llm'
        }, providers: [{ id: 'qwen', name: 'Qwen' }, { id: 'doubaochat', name: '豆包' }] };
        for (const picker of [window.controlPicker, window.displayPicker]) picker.handleMessage(message);
    });
    assert.equal(await page.$eval('#controlChatModelTierPanel .chat-model-tier-levels .is-selected', node => node.textContent), '轻量');
    assert.equal(await page.$eval('#displayChatModelTierPanel [data-current-model]', node => node.textContent), '当前模型名：Qwen3.6-Flash');
    await page.evaluate(() => window.controlPicker.handleMessage({ type: 'chatModelTierConfig', selection: {
        providerId: null, tiersByProvider: { qwen: 'mini', doubaochat: 'mini' },
        modelName: 'agent-model', profileMode: 'agent'
    }, providers: [{ id: 'qwen', name: 'Qwen' }] }));
    assert.equal(await page.$eval('#controlChatModelTierPanel [data-provider]', node => node.disabled), true);
    assert.equal(await page.$$eval('#controlChatModelTierPanel .chat-model-tier-levels button', buttons => buttons.every(button => button.disabled)), true);
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
