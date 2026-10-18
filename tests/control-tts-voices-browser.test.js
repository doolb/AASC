'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const cheerio = require('cheerio');
const { WebSocketServer } = require('ws');
const puppeteer = require('puppeteer-core');
const { normalizeSettings, redactSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { createTtsProviderWs } = require('../src/apps/server/modules/tts/tts-provider-ws');
const { listDoubaoVoices } = require('../src/apps/server/modules/chat2api/chat2api-doubao-voices');
const { createApiSpeechAdapters } = require('../src/apps/server/modules/chat2api/chat2api-api-speech-adapters');
const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium'].find(p => p && fs.existsSync(p));

function markup(kind) {
    const $ = cheerio.load(fs.readFileSync(path.join(root, kind === 'control' ? 'upload.html' : 'display.html'), 'utf8'));
    $('script,link,iframe,img,video,audio,source').remove();
    const sheets = kind === 'control' ? ['theme.css', 'upload.css', 'tts-voice-picker.css']
        : ['theme.css', 'display.css', 'display-mmd.css', 'tts-voice-picker.css'];
    $('head').append('<style>' + sheets.map(file => fs.readFileSync(path.join(root, 'css', file), 'utf8')).join('\n') + '</style>');
    return $.html();
}

// 按实际主题规则计算双端样式，防止浅色通用button的重要声明抹平选中状态。
async function assertVoiceButtonStates(page, prefix) {
    await page.bringToFront();
    const list = '#' + prefix + 'TtsVoiceList';
    const selected = list + ' [aria-selected="true"]';
    const normal = list + ' [aria-selected="false"]';
    const originalTheme = await page.evaluate(() => ['data-theme', 'data-theme-mode'].map(name => document.documentElement.getAttribute(name)));
    const snapshot = () => page.$eval(list, element => {
        const read = selector => {
            const button = element.querySelector(selector), style = getComputedStyle(button);
            const mark = button.querySelector('.display-tts-voice-mark');
            return { background: style.backgroundImage, color: style.color, border: style.borderTopColor,
                shadow: style.boxShadow, detail: getComputedStyle(button.querySelector('small')).color,
                mark: getComputedStyle(mark).visibility, markColor: getComputedStyle(mark).color,
                disabled: button.disabled, selected: button.getAttribute('aria-selected') };
        };
        return { selected: read('[aria-selected="true"]'), normal: read('[aria-selected="false"]') };
    });
    const assertStates = (state, label) => {
        assert.match(state.selected.background, /linear-gradient/, label);
        assert.equal(state.normal.background, 'none', label + ' 普通项不可被全局渐变覆盖');
        assert.equal(state.selected.color, 'rgb(255, 255, 255)', label);
        assert.notEqual(state.selected.color, state.normal.color, label);
        assert.notEqual(state.selected.border, state.normal.border, label);
        assert.notEqual(state.selected.shadow, 'none', label);
        assert.equal(state.normal.shadow, 'none', label);
        for (const button of [state.selected, state.normal]) assert.equal(button.detail, button.color, label + ' 副标题继承按钮文字');
        assert.equal(state.selected.mark, 'visible', label);
        assert.equal(state.selected.markColor, state.selected.color, label);
        assert.equal(state.normal.mark, 'hidden', label);
        assert.equal(state.selected.selected, 'true');
        assert.equal(state.normal.selected, 'false');
    };
    for (const [theme, mode] of [['light', 'light'], ['mint', 'light'], ['dark', 'dark']]) {
        await page.evaluate(({ theme, mode }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.dataset.themeMode = mode;
        }, { theme, mode });
        await page.mouse.move(1, 1);
        assertStates(await snapshot(), prefix + '/' + theme);
        await page.hover(normal);
        const hover = await snapshot();
        assert.equal(hover.normal.background, 'none', '悬停普通项仍保持非选中皮肤');
        assert.equal(hover.normal.selected, 'false');
        assert.equal(hover.normal.mark, 'hidden');
        await page.focus(normal);
        await page.keyboard.press('Tab');
        assert.ok(await page.evaluate(() => {
            const button = document.activeElement, style = getComputedStyle(button);
            return button.matches('.display-tts-voice-option:focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
        }), '键盘焦点可见');
        await page.$eval(list, element => {
            for (const button of element.querySelectorAll('button')) button.disabled = true;
        });
        await page.mouse.move(1, 1);
        const disabled = await snapshot();
        assertStates(disabled, prefix + '/' + theme + '/disabled');
        assert.equal(disabled.selected.disabled, true);
        assert.equal(disabled.normal.disabled, true);
        await page.$eval(list, element => {
            for (const button of element.querySelectorAll('button')) button.disabled = false;
        });
    }
    await page.evaluate(values => {
        ['data-theme', 'data-theme-mode'].forEach((name, index) => {
            if (values[index] === null) document.documentElement.removeAttribute(name);
            else document.documentElement.setAttribute(name, values[index]);
        });
        document.activeElement.blur();
    }, originalTheme);
}

test('控制端真实WS快选与显示端双向同步，滑条仅松手保存，权限/断线/手机布局保持', { skip: !chrome, timeout: 60000 }, async t => {
    let settings = normalizeSettings({ aiReplyDefault: { provider: 'doubao-chat' },
        providers: { 'doubao-chat': { enabled: true }, 'qwen-chat': { enabled: true }, 'qwen-api': { model: 'qwen3-tts-flash' } } }, {}, { recoverLegacyModel: true });
    let failSave = false;
    const requests = [], controls = new Set(), displays = new Set();
    const server = http.createServer((request, response) => {
        if (!['/control-fixture', '/display-fixture'].includes(request.url)) { response.writeHead(404); response.end(); return; }
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(markup(request.url.includes('control') ? 'control' : 'display'));
    });
    const sockets = new WebSocketServer({ server });
    t.after(() => { for (const ws of sockets.clients) ws.terminate(); sockets.close(); server.close(); });
    const handler = createTtsProviderWs({
        config: { getPublicTtsProviderSettings: () => redactSettings(settings),
            setTtsProviderSettings: patch => { if (failSave) throw Error('测试保存失败'); settings = normalizeSettings(patch, settings); } },
        service: { voices: async id => id === 'doubao-chat' ? listDoubaoVoices() : id === 'qwen-api' ? createApiSpeechAdapters()['qwen-api'].voices({ model: settings.providers['qwen-api'].model }) : [{ id: 'fixture-qwen', name: '测试千问音色', gender: 'female' }] },
        isControl: ws => controls.has(ws), isDisplay: ws => displays.has(ws),
        broadcast: message => { for (const ws of sockets.clients) if (ws.readyState === 1) ws.send(JSON.stringify(message)); }
    });
    const source = fs.readFileSync(require.resolve('../src/apps/server/boot/server-app'), 'utf8');
    const start = source.indexOf('function handleDisplayMessageFallback(');
    const end = source.indexOf('    if (displayVoiceListeningConfig.handle', start);
    const fallback = vm.runInNewContext('(' + source.slice(start, end) + '\n})', { ttsProviderWs: handler });
    sockets.on('connection', (ws, request) => {
        const control = request.url === '/control';
        (control ? controls : displays).add(ws);
        ws.on('close', () => { controls.delete(ws); displays.delete(ws); });
        ws.on('message', async raw => {
            const data = JSON.parse(raw); requests.push({ control, ...data });
            if (control) await handler.handle(ws, data);
            else { data.displayId = 'fixture-display'; fallback('fixture-display', data, ws); }
        });
        ws.send(JSON.stringify(handler.snapshot()));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const control = await browser.newPage(), display = await browser.newPage(), errors = [];
    for (const page of [control, display]) { page.on('pageerror', error => errors.push(error.message)); await page.setViewport({ width: 390, height: 740 }); }
    // 双页面测试不依赖后台标签页的动画帧，轮询权威DOM变化。
    const waitFor = (page, predicate, ...args) => page.waitForFunction(predicate, { polling: 50, timeout: 8000 }, ...args);
    await control.goto(base + '/control-fixture', { waitUntil: 'domcontentloaded' });
    t.diagnostic('控制页面已加载');
    await control.addScriptTag({ path: path.join(root, 'js/websocket.js') });
    await control.addScriptTag({ path: path.join(root, 'js/tts-voice-picker.js') });
    await control.addScriptTag({ path: path.join(root, 'js/control-tts-voices.js') });
    await control.evaluate(() => {
        window.originalPageCalls = 0;
        window.TtsProviderSettings = { handleConfig() { window.originalPageCalls++; }, handleVoices() { window.originalPageCalls++; }, handleDisconnected() {} };
        window.FloatingControl = { isOpen: true, toggle() { this.isOpen = !this.isOpen; } };
        window.WebSocketManager.connect();
    });
    await display.goto(base + '/display-fixture', { waitUntil: 'domcontentloaded' });
    t.diagnostic('显示页面已加载');
    await display.addScriptTag({ path: path.join(root, 'js/tts-voice-picker.js') });
    await display.addScriptTag({ path: path.join(root, 'js/display-tts-voices.js') });
    await display.evaluate(() => {
        const listeners = new Map();
        const bus = { subscribe(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
            publish(name, value) { for (const callback of listeners.get(name) || []) callback(value); } };
        const ws = new WebSocket('ws://' + location.host + '/display-fixture');
        window.DisplayTtsVoices.init({ bus, send(message) { if (ws.readyState !== 1) return false; ws.send(JSON.stringify(message)); return true; } });
        ws.onmessage = event => bus.publish('server.message', JSON.parse(event.data));
        ws.onopen = () => bus.publish('transport.changed', { available: true });
        document.querySelector('.display-stage-lighting-control').hidden = false;
    });
    await Promise.all([waitFor(control, () => !document.querySelector('#controlTtsProviderSelect').disabled),
        waitFor(display, () => !document.querySelector('#displayTtsProviderSelect').disabled)]);
    t.diagnostic('两端已取得初始配置');
    await control.bringToFront();
    await control.click('#controlTtsVoiceToggle');
    assert.equal(await control.evaluate(() => FloatingControl.isOpen), false);
    await waitFor(control, () => document.querySelectorAll('#controlTtsVoiceList [data-voice-id]').length === 94);
    assert.equal(await control.$eval('#controlTtsSpeedControl', node => node.hidden), true);
    await control.bringToFront();
    await control.select('#controlTtsFilterGender', '女声');
    assert.equal(await control.$$eval('#controlTtsVoiceList [data-voice-id]', nodes => nodes.length), 32);
    const chosen = listDoubaoVoices().find(voice => voice.name === '桂乡甜妞');
    await control.bringToFront();
    await control.type('#controlTtsVoiceSearch', '桂乡');
    await control.bringToFront();
    await control.click('#controlTtsVoiceList [data-voice-id]');
    await waitFor(display, voice => document.querySelector('#displayTtsCurrentVoiceName').textContent === voice, chosen.id);
    assert.equal(settings.aiReplyDefault.voice, chosen.id);
    await display.bringToFront();
    await display.click('#displayTtsVoiceToggle');
    await waitFor(display, () => document.querySelectorAll('#displayTtsVoiceList [data-voice-id]').length === 94);
    await control.evaluate(() => document.querySelector('#controlTtsVoiceClear').click());
    await assertVoiceButtonStates(control, 'control');
    await assertVoiceButtonStates(display, 'display');
    await control.addScriptTag({ path: path.join(root, 'js/self-test.js') });
    const requestsBeforeCheck = requests.length;
    const checks = await control.evaluate(async () => {
        const check = SelfTest.tests.find(item => item.id === 'control_tts_voice_picker');
        const valid = await check.run();
        const override = document.createElement('style');
        override.textContent = '#controlTtsVoiceList button[aria-selected="false"] { background: linear-gradient(red, blue) !important; }';
        document.head.append(override);
        const invalid = await check.run();
        override.remove();
        return { valid, invalid };
    });
    assert.equal(checks.valid.success, true);
    assert.equal(checks.invalid.success, false, '只读自测应发现未选中项被覆盖成渐变按钮');
    assert.equal(requests.length, requestsBeforeCheck, '只读自测不发送配置或目录请求');
    const other = listDoubaoVoices().find(voice => voice.id !== chosen.id);
    await display.bringToFront();
    await display.$eval('#displayTtsVoiceList [data-voice-id="' + other.id + '"]', button => button.click());
    await waitFor(control, voice => document.querySelector('#controlTtsCurrentVoiceName').textContent === voice, other.name);
    assert.equal(settings.aiReplyDefault.voice, other.id);
    await control.bringToFront();
    await control.select('#controlTtsProviderSelect', 'qwen-chat');
    await waitFor(control, () => !document.querySelector('#controlTtsSpeed').disabled);
    await waitFor(display, () => document.querySelector('#displayTtsProviderSelect').value === 'qwen-chat');
    const beforeSpeed = requests.filter(request => Object.hasOwn(request, 'speed')).length;
    await control.bringToFront();
    await control.$eval('#controlTtsSpeed', slider => { slider.value = '3'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(requests.filter(request => Object.hasOwn(request, 'speed')).length, beforeSpeed);
    assert.equal(await control.$eval('#controlTtsSpeedValue', node => node.textContent), '3');
    await control.bringToFront();
    await control.$eval('#controlTtsSpeed', slider => slider.dispatchEvent(new Event('change', { bubbles: true })));
    await waitFor(display, () => document.querySelector('#displayTtsSpeed').value === '3');
    assert.equal(settings.providers['qwen-chat'].defaultSpeed, 3);
    assert.equal(settings.providers.system.defaultSpeed, 0);
    assert.equal(await control.$eval('#controlTtsVolume', node => node.value), '100');
    assert.equal(await display.$eval('#displayTtsVolume', node => node.value), '100');
    const beforeVolume = requests.filter(request => Object.hasOwn(request, 'volume')).length;
    await control.$eval('#controlTtsVolume', slider => { slider.value = '35'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await control.$eval('#controlTtsVolumeValue', node => node.textContent), '35%');
    assert.equal(requests.filter(request => Object.hasOwn(request, 'volume')).length, beforeVolume, '拖动只预览');
    await control.$eval('#controlTtsVolume', slider => slider.dispatchEvent(new Event('change', { bubbles: true })));
    await waitFor(display, () => document.querySelector('#displayTtsVolume').value === '35');
    assert.equal(settings.defaultVolume, 35);
    assert.equal(settings.aiReplyDefault.provider, 'qwen-chat');
    await display.$eval('#displayTtsVolume', slider => { slider.value = '0'; slider.dispatchEvent(new Event('input')); slider.dispatchEvent(new Event('change')); });
    await waitFor(control, () => document.querySelector('#controlTtsVolume').value === '0');
    assert.equal(settings.defaultVolume, 0);
    failSave = true;
    await display.$eval('#displayTtsVolume', slider => { slider.value = '33'; slider.dispatchEvent(new Event('input')); slider.dispatchEvent(new Event('change')); });
    await waitFor(display, () => document.querySelector('#displayTtsVoiceStatus').textContent.includes('测试保存失败'));
    assert.equal(await display.$eval('#displayTtsVolume', node => node.value), '0', '失败时恢复权威值');
    failSave = false;
    // 错误回显恢复滑条与选择，不因input预览提前修改权威值。
    failSave = true;
    await display.bringToFront();
    await display.$eval('#displayTtsSpeed', slider => { slider.value = '5'; slider.dispatchEvent(new Event('input')); slider.dispatchEvent(new Event('change')); });
    await waitFor(display, () => document.querySelector('#displayTtsVoiceStatus').textContent.includes('测试保存失败'));
    assert.equal(await display.$eval('#displayTtsSpeed', node => node.value), '3');
    failSave = false;
    await control.bringToFront();
    await control.select('#controlTtsProviderSelect', 'qwen-api');
    await waitFor(control, () => !document.querySelector('#controlTtsProviderSelect').disabled);
    // 旧模型读取即恢复3.1，无需用户再提交模型，语速与68项目录直接可用。
    assert.equal(await control.$eval('#controlTtsSpeedControl', node => node.hidden), false);
    await waitFor(control, () => !document.querySelector('#controlTtsSpeedControl').hidden);
    await waitFor(control, () => document.querySelectorAll('#controlTtsVoiceList [data-voice-id]').length === 68);
    await waitFor(display, () => document.querySelectorAll('#displayTtsVoiceList [data-voice-id]').length === 68);
    await control.bringToFront();
    await control.select('#controlTtsFilterGender', '女声');
    assert.equal(await control.$$eval('#controlTtsVoiceList [data-voice-id]', nodes => nodes.length), 47);
    await control.evaluate(() => document.querySelector('#controlTtsVoiceClear').click());
    await control.$eval('#controlTtsVoiceList [data-voice-id="Emily_v3.1"]', button => button.click());
    await waitFor(display, () => document.querySelector('#displayTtsCurrentVoiceName').textContent === 'Emily');
    assert.equal(settings.aiReplyDefault.voice, 'Emily_v3.1');
    await control.bringToFront();
    await control.select('#controlTtsProviderSelect', 'doubao-chat');
    await waitFor(control, () => document.querySelector('#controlTtsProviderSelect').value === 'doubao-chat' && !document.querySelector('#controlTtsProviderSelect').disabled);
    assert.equal(settings.aiReplyDefault.voice, other.id);
    await control.evaluate(() => document.querySelector('#controlTtsVoiceClear').click());
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 740 }, { width: 740, height: 390 }, { width: 390, height: 400 }]) {
        await control.setViewport(viewport);
        const layout = await control.evaluate(() => {
            const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom }; };
            return { panel: rect('controlTtsVoicePanel'), toggle: rect('controlTtsVoiceToggle'), gear: rect('floatingControlToggle'), mic: rect('floatingRecordingPauseButton') };
        });
        for (const rect of [layout.panel, layout.toggle]) assert.ok(rect.x >= 0 && rect.y >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height, JSON.stringify({viewport,layout}));
        for (const button of [layout.gear, layout.mic]) assert.ok(layout.toggle.bottom <= button.y || layout.toggle.y >= button.bottom, '工具按钮不能互相遮挡');
    }
    await control.bringToFront();
    await control.keyboard.press('Escape');
    assert.equal(await control.$eval('#controlTtsVoicePanel', node => node.hidden), true);
    await control.bringToFront();
    await control.click('#controlTtsVoiceToggle');
    await control.bringToFront();
    await control.mouse.click(5, 5);
    assert.equal(await control.$eval('#controlTtsVoicePanel', node => node.hidden), true);
    await control.evaluate(() => { ControlTtsVoices.init(); ControlTtsVoices.init(); WebSocketManager.ws.close(); });
    await waitFor(control, () => document.querySelector('#controlTtsProviderSelect').disabled);
    assert.equal(await control.$eval('#controlTtsCurrentVoiceName', node => node.textContent), '等待同步');
    assert.deepEqual(await control.$eval('#controlTtsVolume', node => ({ value: node.value, disabled: node.disabled })), { value: '100', disabled: true });
    await control.evaluate(() => WebSocketManager.connect());
    await waitFor(control, () => !document.querySelector('#controlTtsProviderSelect').disabled);
    assert.deepEqual(await control.$eval('#controlTtsVolume', node => ({ value: node.value, disabled: node.disabled })), { value: '0', disabled: false });
    assert.equal(await control.$$eval('#controlTtsVoicePanel', nodes => nodes.length), 1);
    assert.ok(await control.evaluate(() => originalPageCalls > 2), '声纹页回显不能被快捷面板吞掉');
    assert.deepEqual(errors, []);
});
