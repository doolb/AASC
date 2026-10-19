'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const { normalizeSettings, redactSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { listDoubaoVoices } = require('../src/apps/server/modules/chat2api/chat2api-doubao-voices');
const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, 'D:/Program Files/chrome-win/chrome.exe', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));

test('真实显示页快选对应目录、搜索、方式记忆、错误回显及完成回复重播', { skip: !chrome, timeout: 45000 }, async t => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'display.html'), 'utf8'));
    $('script,link').remove();
    $('head').append('<style>' + ['theme.css','display.css','display-mmd.css', 'tts-voice-picker.css','display-chat.css'].map(file => fs.readFileSync(path.join(root,'css',file),'utf8')).join('\n') + '</style>');
    await page.setViewport({ width: 390, height: 740 });
    await page.setContent($.html());
    await page.addScriptTag({ path: path.join(root, 'js/tts-voice-picker.js') });
    await page.addScriptTag({ path: path.join(root, 'js/display-tts-voices.js') });
    await page.addScriptTag({ path: path.join(root, 'js/display-chat.js') });
    await page.evaluate(() => {
        window.sent = [];
        const subscribers = new Map();
        window.bus = { subscribe(name, fn) { if (!subscribers.has(name)) subscribers.set(name, []); subscribers.get(name).push(fn); },
            publish(name, message) { for (const fn of subscribers.get(name) || []) fn(message); } };
        const send = message => { window.sent.push(message); return true; };
        window.DisplayTtsVoices.init({ bus: window.bus, send });
        window.DisplayChat.init({ root: document.querySelector('#displayChatLayer'), bus: window.bus, send });
        document.querySelector('.display-stage-lighting-control').hidden = false;
        window.DisplayChat.setVisible(false);
    });
    const settings = redactSettings(normalizeSettings({ aiReplyDefault: { provider: 'doubao-chat' } }));
    await page.evaluate(config => window.bus.publish('server.message', { type: 'ttsProviderConfig', config }), settings);
    await page.click('#displayTtsVoiceToggle');
    const query = await page.evaluate(() => window.sent.findLast(x => x.type === 'getTtsProviderVoices'));
    assert.equal(query.provider, 'doubao-chat');
    await page.evaluate(({ requestId, voices }) => window.bus.publish('server.message', {
        type: 'ttsProviderVoices', provider: 'doubao-chat', requestId, voices, success: true
    }), { requestId: query.requestId, voices: listDoubaoVoices() });
    assert.equal(await page.$$eval('#displayTtsVoiceList [data-voice-id]', elements => elements.length), 94);
    const bounds = await page.$eval('#displayTtsVoicePanel', node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}; });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= 390 && bounds.bottom <= 740);
    fs.mkdirSync(path.resolve(__dirname, '../.cache/voice-selection'), { recursive: true });
    await page.screenshot({path:path.resolve(__dirname,'../.cache/voice-selection/display-voices.png')});
    await page.type('#displayTtsVoiceSearch', '桂乡');
    assert.equal(await page.$$eval('#displayTtsVoiceList [data-voice-id]', elements => elements.length), 1);
    const selected = listDoubaoVoices().find(v => v.name === '桂乡甜妞');
    await page.click('#displayTtsVoiceList [data-voice-id]');
    const selection = await page.evaluate(() => window.sent.findLast(x => x.type === 'setChatTtsSelection'));
    assert.equal(selection.voice, selected.id);
    await page.evaluate(({ config, requestId }) => window.bus.publish('server.message', {
        type: 'ttsProviderConfig', config, requestId, success: false, message: '保存失败'
    }), { config: settings, requestId: selection.requestId });
    assert.match(await page.$eval('#displayTtsVoiceStatus', e => e.textContent), /保存失败/);
    await page.select('#displayTtsProviderSelect', 'qwen-api');
    const oldQuery = await page.evaluate(() => window.sent.findLast(x => x.type === 'getTtsProviderVoices'));
    // 模拟晚到的豆包目录，不得覆盖当前方式。
    await page.evaluate(({ requestId, voices }) => window.bus.publish('server.message', {
        type: 'ttsProviderVoices', provider: 'doubao-chat', requestId, voices, success: true
    }), { requestId: query.requestId, voices: listDoubaoVoices() });
    assert.equal(await page.$eval('#displayTtsProviderSelect', e => e.value), 'qwen-api');
    assert.equal(oldQuery.provider, 'qwen-api');
    await page.evaluate(() => {
        document.querySelector('#displayTtsVoicePanel').hidden=true;
        window.DisplayChat.setVisible(true);
        window.bus.publish('server.message', { type: 'displayId', id: 'self' });
        window.bus.publish('server.message', { type: 'chatInput', requestId: 'reply', content: '用户输入' });
    });
    assert.equal(await page.$$eval('.display-chat-play-btn', elements => elements.length), 0);
    await page.evaluate(() => window.bus.publish('server.message', { type: 'chatResponse', requestId: 'reply', success: true,
        message: { content: '回复正文', speech: '应朗读文字', reasoning: '不要朗读的思考' } }));
    await page.click('.display-chat-play-btn');
    const play = await page.evaluate(() => window.sent.findLast(x => x.type === 'tts' && x.action === 'play'));
    assert.equal(play.text, '应朗读文字');
    assert.equal(play.displayId, 'self');
    assert.equal(play.chatReplyContext.userText, '用户输入');
    await page.evaluate(requestId => window.bus.publish('server.message', {
        type: 'chatTtsPlayback', requestId, status: 'error', message: '合成失败'
    }), play.requestId);
    assert.equal(await page.$eval('.display-chat-play-btn', e => e.disabled), false);
    // 覆盖本端实际发送路径，以及普通LLM的字符串message、顶层speech协议。
    await page.evaluate(() => {
        window.DisplayChat.sendVoiceMessage('自己的原始输入');
        const request = window.sent.findLast(x => x.type === 'chatMessage');
        window.bus.publish('server.message', { type: 'chatInput', requestId: request.requestId, content: request.content });
        window.bus.publish('server.message', { type: 'chatResponse', requestId: request.requestId, success: true,
            message: '含Markdown的正文', speech: '应该朗读的speech' });
    });
    await page.$eval('.display-chat-message:last-child .display-chat-play-btn', button => button.click());
    const ownPlay = await page.evaluate(() => window.sent.findLast(x => x.type === 'tts' && x.action === 'play'));
    assert.equal(ownPlay.text, '应该朗读的speech');
    assert.equal(ownPlay.chatReplyContext.userText, '自己的原始输入');
    await page.evaluate(requestId => window.dispatchEvent(new CustomEvent('display-manual-tts-finished', {
        detail: { requestId, status: 'cancelled' }
    })), ownPlay.requestId);
    assert.equal(await page.$eval('.display-chat-message:last-child .display-chat-play-btn', button => button.textContent), '🔊');
    await page.addScriptTag({ path: path.join(root, 'js/self-test.js') });
    const selfTest = await page.evaluate(voices => {
        const ws = new EventTarget();
        ws.readyState = WebSocket.OPEN;
        ws.send = raw => {
            const request = JSON.parse(raw);
            queueMicrotask(() => ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
                type: 'ttsProviderVoices', requestId: request.requestId, provider: 'doubao-chat', success: true, voices
            }) })));
        };
        window.WebSocketManager = { ws };
        return window.SelfTest.tests.find(test => test.id === 'doubao_voice_catalog').run();
    }, listDoubaoVoices());
    assert.equal(selfTest.success, true);
    assert.deepEqual(errors, []);
});

test('音色试听把 WAV 缓存在面板内，重播不请求服务端且最多保留30项', { skip: !chrome, timeout: 45000 }, async t => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'display.html'), 'utf8'));
    $('script,link').remove();
    $('head').append('<style>' + ['theme.css', 'display.css', 'display-mmd.css', 'tts-voice-picker.css'].map(file =>
        fs.readFileSync(path.join(root, 'css', file), 'utf8')).join('\n') + '</style>');
    await page.setContent($.html());
    await page.addScriptTag({ path: path.join(root, 'js/tts-voice-picker.js') });
    await page.addScriptTag({ path: path.join(root, 'js/display-tts-voices.js') });
    await page.evaluate(() => {
        window.sent = [];
        window.downloads = 0;
        window.plays = 0;
        window.revoked = [];
        const realRevoke = URL.revokeObjectURL.bind(URL);
        URL.revokeObjectURL = url => { window.revoked.push(url); realRevoke(url); };
        window.Audio = class {
            constructor(url) { this.src = url; }
            play() { window.plays++; return Promise.resolve(); }
            pause() {}
        };
        window.fetch = async () => {
            window.downloads++;
            const wav = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69]);
            return new Response(new Blob([wav], { type: 'audio/wav' }), { status: 200 });
        };
        const listeners = new Map();
        window.bus = { subscribe(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
            publish(name, value) { for (const fn of listeners.get(name) || []) fn(value); } };
        window.DisplayTtsVoices.init({ bus: window.bus, send(message) {
            window.sent.push(message);
            if (message.type === 'previewTtsVoice') queueMicrotask(() => window.bus.publish('server.message', {
                type: 'ttsVoicePreview', requestId: message.requestId, success: true,
                audioUrl: '/uploads/tts/tts_mem_12345678-1234-1234-1234-123456789abc.wav'
            }));
            return true;
        } });
        document.querySelector('.display-stage-lighting-control').hidden = false;
    });
    const config = redactSettings(normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat', voice: 'voice-0' } }));
    await page.evaluate(value => window.bus.publish('server.message', { type: 'ttsProviderConfig', config: value }), config);
    await page.click('#displayTtsVoiceToggle');
    const query = await page.evaluate(() => window.sent.findLast(value => value.type === 'getTtsProviderVoices'));
    const voices = Array.from({ length: 31 }, (_, index) => ({ id: 'voice-' + index,
        name: '测试音色' + index, gender: 'female', tags: [] }));
    await page.evaluate(({ requestId, values }) => window.bus.publish('server.message', {
        type: 'ttsProviderVoices', provider: 'qwen-chat', requestId, success: true, voices: values
    }), { requestId: query.requestId, values: voices });
    const preview = index => '#displayTtsVoiceList [data-voice-id="voice-' + index + '"] + .display-tts-voice-preview';
    await page.$eval(preview(0), button => button.click());
    await page.waitForFunction(() => document.querySelector('[data-voice-id="voice-0"] + .display-tts-voice-preview').textContent === '重播');
    await page.$eval(preview(0), button => button.click());
    let state = await page.evaluate(() => ({ requests: sent.filter(value => value.type === 'previewTtsVoice').length,
        downloads, plays, selected: document.querySelector('[data-voice-id="voice-0"]').getAttribute('aria-selected') }));
    assert.deepEqual(state, { requests: 1, downloads: 1, plays: 2, selected: 'true' });
    for (let index = 1; index < 31; index++) {
        await page.$eval(preview(index), button => button.click());
        await page.waitForFunction(id => document.querySelector('[data-voice-id="voice-' + id + '"] + .display-tts-voice-preview').textContent === '重播', {}, index);
    }
    state = await page.evaluate(() => ({ requests: sent.filter(value => value.type === 'previewTtsVoice').length,
        downloads, revoked: revoked.length, first: document.querySelector('[data-voice-id="voice-0"] + .display-tts-voice-preview').textContent,
        saves: sent.filter(value => value.type === 'setChatTtsSelection').length }));
    assert.deepEqual(state, { requests: 31, downloads: 31, revoked: 1, first: '试听', saves: 0 });
    await page.$eval(preview(0), button => button.click());
    await page.waitForFunction(() => document.querySelector('[data-voice-id="voice-0"] + .display-tts-voice-preview').textContent === '重播');
    assert.equal(await page.evaluate(() => sent.filter(value => value.type === 'previewTtsVoice').length), 32);
    const quieter = redactSettings(normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat', voice: 'voice-0' }, defaultVolume: 35 }));
    await page.evaluate(value => window.bus.publish('server.message', { type: 'ttsProviderConfig', config: value }), quieter);
    await page.$eval(preview(0), button => button.click());
    await page.waitForFunction(() => sent.filter(value => value.type === 'previewTtsVoice').length === 33
        && document.querySelector('[data-voice-id="voice-0"] + .display-tts-voice-preview').textContent === '重播');
    assert.deepEqual(errors, []);
});
