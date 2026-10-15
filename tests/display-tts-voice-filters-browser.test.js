'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const { normalizeSettings, redactSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { listDoubaoVoices } = require('../src/apps/server/modules/chat2api/chat2api-doubao-voices');
const publicRoot = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, 'D:/Program Files/chrome-win/chrome.exe', '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

test('正式面板三下拉交集、权威选中与异步/缓存定位', { skip: !chrome, timeout: 45000 }, async t => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const $ = cheerio.load(fs.readFileSync(path.join(publicRoot, 'display.html'), 'utf8'));
    $('script,link').remove();
    $('head').append('<style>' + ['theme.css', 'display.css', 'display-mmd.css', 'tts-voice-picker.css'].map(file => fs.readFileSync(path.join(publicRoot, 'css', file), 'utf8')).join('\n') + '</style>');
    await page.setViewport({ width: 390, height: 740 });
    await page.setContent($.html());
    await page.addScriptTag({ path: path.join(publicRoot, 'js/tts-voice-picker.js') });
    await page.addScriptTag({ path: path.join(publicRoot, 'js/display-tts-voices.js') });
    await page.evaluate(() => {
        const listeners = new Map(); window.sent = [];
        window.bus = { subscribe(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
            publish(name, message) { for (const fn of listeners.get(name) || []) fn(message); } };
        window.DisplayTtsVoices.init({ bus: window.bus, send: message => { window.sent.push(message); return true; } });
        document.querySelector('.display-stage-lighting-control').hidden = false;
    });
    const emit = message => page.evaluate(value => window.bus.publish('server.message', value), message);
    const settings = voice => redactSettings(normalizeSettings({ aiReplyDefault: { provider: 'doubao-chat', voice },
        providers: { 'doubao-chat': { defaultVoice: voice } } }));
    const catalog = listDoubaoVoices(), initialVoice = catalog.find(voice => voice.name === '桂乡甜妞'), lastVoice = catalog.at(-1);
    const query = () => page.evaluate(() => window.sent.findLast(message => message.type === 'getTtsProviderVoices'));
    const count = () => page.$$eval('#displayTtsVoiceList [data-voice-id]', items => items.length);
    const selected = () => page.$$eval('#displayTtsVoiceList [aria-selected="true"]', items => items.map(item => item.dataset.voiceId));
    const visible = () => page.waitForFunction(() => {
        const item = document.querySelector('#displayTtsVoiceList [aria-selected="true"]');
        if (!item) return false;
        const a = item.getBoundingClientRect(), b = document.querySelector('#displayTtsVoiceList').getBoundingClientRect();
        const panel = document.querySelector('#displayTtsVoicePanel').getBoundingClientRect();
        return a.top >= Math.max(b.top, panel.top) && a.bottom <= Math.min(b.bottom, panel.bottom);
    });
    assert.equal(await page.$$eval('.display-tts-voice-filters select', items => items.length), 3);
    // 首次先打开，再收到配置及异步目录，仍应准确定位当前音色。
    await page.click('#displayTtsVoiceToggle');
    await emit({ type: 'ttsProviderConfig', config: settings(initialVoice.id) });
    const initialQuery = await query();
    await emit({ type: 'ttsProviderVoices', provider: 'doubao-chat', requestId: initialQuery.requestId, success: true, voices: catalog });
    await visible();
    assert.equal(await count(), 94);
    assert.deepEqual(await selected(), [initialVoice.id]);
    assert.equal(await page.$eval('#displayTtsCurrentVoiceName', item => item.textContent), initialVoice.name);
    assert.equal(await page.$eval('#displayTtsVoicePanel', item => item.scrollTop), 0);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.ok(await page.$eval('#displayTtsVoiceList', list => {
        const current = list.querySelector('[aria-selected="true"]'), other = list.querySelector('[aria-selected="false"]');
        return getComputedStyle(current).backgroundColor !== getComputedStyle(other).backgroundColor
            && current.querySelector('.display-tts-voice-mark')?.textContent === '✓';
    }));
    const messagesBeforeFilter = await page.evaluate(() => window.sent.length);
    await page.select('#displayTtsFilterGender', '女声'); assert.equal(await count(), 32);
    await page.select('#displayTtsFilterAge', '青年');
    await page.select('#displayTtsFilterAccent', '广西口音'); assert.equal(await count(), 1);
    await page.type('#displayTtsVoiceSearch', '不存在'); assert.equal(await count(), 0);
    assert.match(await page.$eval('#displayTtsVoiceList', item => item.textContent), /没有匹配/);
    assert.equal(await page.evaluate(() => window.sent.length), messagesBeforeFilter);
    await page.click('#displayTtsVoiceClear'); assert.equal(await count(), 94);
    await page.type('#displayTtsVoiceSearch', '虎子');
    await page.click('#displayTtsVoiceList [data-voice-id]');
    const failed = await page.evaluate(() => window.sent.findLast(message => message.type === 'setChatTtsSelection'));
    assert.equal(await page.$eval('#displayTtsCurrentVoiceName', item => item.textContent), initialVoice.name);
    await emit({ type: 'ttsProviderConfig', config: settings(initialVoice.id), requestId: failed.requestId, success: false, message: '保存失败' });
    await page.click('#displayTtsVoiceClear'); assert.deepEqual(await selected(), [initialVoice.id]);
    // 成功回显后才改变CSS；关闭重开清条件并定位目录末尾，缓存不重复查询。
    await page.type('#displayTtsVoiceSearch', '虎子'); await page.click('#displayTtsVoiceList [data-voice-id]');
    const saved = await page.evaluate(() => window.sent.findLast(message => message.type === 'setChatTtsSelection'));
    await emit({ type: 'ttsProviderConfig', config: settings(lastVoice.id), requestId: saved.requestId, success: true });
    assert.deepEqual(await selected(), [lastVoice.id]);
    const queriesBefore = await page.evaluate(() => window.sent.filter(message => message.type === 'getTtsProviderVoices').length);
    await page.click('#displayTtsVoiceClose'); await page.click('#displayTtsVoiceToggle'); await visible();
    assert.equal(await page.$eval('#displayTtsVoiceSearch', input => input.value), ''); assert.equal(await count(), 94);
    assert.equal(await page.evaluate(() => window.sent.filter(message => message.type === 'getTtsProviderVoices').length), queriesBefore);
    for (const id of ['Gender', 'Age', 'Accent']) assert.equal(await page.$eval('#displayTtsFilter' + id, select => select.value), 'all');
    const bounds = await page.$eval('#displayTtsVoicePanel', element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= 390 && bounds.bottom <= 740);
    const filterBounds = await page.$$eval('.display-tts-voice-filters select', items => items.map(item => { const r=item.getBoundingClientRect(); return { y:r.y, right:r.right }; }));
    assert.ok(filterBounds.every(item => item.y === filterBounds[0].y && item.right <= bounds.right));
    fs.mkdirSync(path.resolve(__dirname, '../.cache/voice-selection'), { recursive: true });
    await page.screenshot({ path: path.resolve(__dirname, '../.cache/voice-selection/display-voice-filters-mobile.png') });
    for (const viewport of [{ width: 740, height: 390 }, { width: 390, height: 400 }]) {
        await page.setViewport(viewport);
        await page.click('#displayTtsVoiceClose'); await page.click('#displayTtsVoiceToggle');
        if (viewport.width > viewport.height) {
            assert.equal(await page.$$eval('.display-tts-voice-settings', nodes => nodes.length), 1);
            const columns = await page.evaluate(() => {
                const left = document.querySelector('.display-tts-voice-settings').getBoundingClientRect();
                const right = document.querySelector('.display-tts-voice-results').getBoundingClientRect();
                return { leftRight: left.right, rightLeft: right.left, topDiff: Math.abs(left.top - right.top) };
            });
            assert.ok(columns.leftRight <= columns.rightLeft && columns.topDiff < 1, '横屏左设置/右音色列表');
        }
        const height = await page.$eval('#displayTtsVoiceList', list => list.getBoundingClientRect().height);
        assert.ok(height >= 100, '横屏或键盘压缩高度时，列表仍须可见');
        await visible();
        if (viewport.width > viewport.height) {
            const panel = await page.$eval('#displayTtsVoicePanel', node => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom }; });
            assert.ok(panel.x >= 0 && panel.y >= 0 && panel.right <= viewport.width && panel.bottom <= viewport.height);
            await page.screenshot({ path: path.resolve(__dirname, '../.cache/voice-selection/display-voice-filters-landscape.png') });
        }
        assert.equal(await page.evaluate(() => window.scrollY), 0);
    }
    await page.setViewport({ width: 390, height: 740 });
    await page.click('#displayTtsVoiceClose'); await page.click('#displayTtsVoiceToggle'); await visible();
    // 其它方式没有年龄/口音标签时只显示未标注，不从名称猜测。
    await page.select('#displayTtsProviderSelect', 'qwen-api');
    const otherQuery = await query();
    const otherSettings = redactSettings(normalizeSettings({ aiReplyDefault: { provider: 'qwen-api', voice: 'fixture' } }));
    const switchId = await page.evaluate(() => window.sent.findLast(message => message.type === 'setChatTtsSelection').requestId);
    await emit({ type: 'ttsProviderConfig', config: otherSettings, requestId: switchId, success: true });
    await emit({ type: 'ttsProviderVoices', provider: 'doubao-chat', requestId: initialQuery.requestId, success: true, voices: catalog });
    await emit({ type: 'ttsProviderVoices', provider: 'qwen-api', requestId: otherQuery.requestId, success: true,
        voices: [{ id: 'fixture', name: '成熟青年北京女孩' }] });
    assert.equal(await count(), 1); await visible();
    for (const id of ['Gender', 'Age', 'Accent']) assert.deepEqual(await page.$$eval('#displayTtsFilter' + id + ' option', items => items.map(item => item.value)), ['all', '未标注']);
    // 无目录、未知已选音色和原生都不静默选择第一项。
    await emit({ type: 'ttsProviderConfig', config: redactSettings(normalizeSettings({ aiReplyDefault: { provider: 'qwen-api', voice: 'missing' } })) });
    assert.deepEqual(await selected(), []); assert.equal(await page.$eval('#displayTtsCurrentVoiceName', item => item.textContent), 'missing');
    await emit({ type: 'ttsProviderConfig', config: redactSettings(normalizeSettings({ aiReplyDefault: { provider: 'system' } })) });
    assert.equal(await count(), 0); assert.match(await page.$eval('#displayTtsCurrentVoiceName', item => item.textContent), /系统/);
    await page.evaluate(() => window.bus.publish('transport.changed', { available: false }));
    assert.equal(await page.$eval('#displayTtsProviderSelect', item => item.disabled), true);
    assert.match(await page.$eval('#displayTtsCurrentVoiceName', item => item.textContent), /等待同步/);
    await page.evaluate(() => window.bus.publish('transport.changed', { available: true }));
    await emit({ type: 'ttsProviderConfig', config: settings(initialVoice.id) }); await visible();
    assert.deepEqual(await selected(), [initialVoice.id]);
    await page.addScriptTag({ path: path.join(publicRoot, 'js/self-test.js') });
    const selfTest = await page.evaluate(async markup => {
        const reads = [];
        window.fetch = async url => { reads.push(url); return { ok: true, text: async () => markup }; };
        const check = window.SelfTest.tests.find(item => item.id === 'display_voice_filters');
        const valid = await check.run();
        markup = markup.replace('id="displayTtsFilterAccent"', 'id="oldAccent"');
        const missing = await check.run();
        return { valid, missing, reads };
    }, $.html());
    assert.equal(selfTest.valid.success, true);
    assert.equal(selfTest.missing.success, false);
    assert.deepEqual(selfTest.reads, ['/display.html', '/display.html']);
    assert.deepEqual(errors, []);
});
