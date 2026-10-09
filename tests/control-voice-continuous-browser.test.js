'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const puppeteer = require('puppeteer');
const publicRoot = path.resolve('src/apps/web-mediacenter/ui/public');
const read = file => fs.readFileSync(path.join(publicRoot, file), 'utf8');

test('真实 VAD 卡片按钮双向切换、权威等待、深浅主题及输入聚焦保持', { timeout: 30000 }, async t => {
    const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium', puppeteer.executablePath()]
        .find(file => file && fs.existsSync(file));
    if (!executablePath) { t.skip('无可用Chromium'); return; }
    const cache = path.join(os.homedir(), '.cache/aasc-control-listening');
    fs.mkdirSync(cache, { recursive: true });
    const browser = await puppeteer.launch({ executablePath, headless: true,
        env: { ...process.env, TMPDIR: cache }, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 360, height: 800 });
        await page.setContent(`<html><head><style>${read('css/theme.css')} ${read('css/upload.css')}</style></head>
            <body><div style="padding:12px"><h3>监听 VAD / 底噪检测</h3><div id="voiceVadPanel"></div><div id="deviceFixture"></div></div></body></html>`);
        await page.evaluate(() => {
            window.currentDisplayId = 'one'; window.sent = []; window.errors = [];
            window.WebSocketManager = { ws: { readyState: 1, send: raw => window.sent.push(JSON.parse(raw)) } };
            window.showToast = message => window.errors.push(message);
        });
        await page.addScriptTag({ content: read('js/device-list.js') });
        await page.evaluate(() => {
            DeviceList.list = [{ id: 'one', ip: '192.168.1.1', capabilities: { cameraCapture: false } }];
            DeviceList.renderVoiceVadPanel();
            document.getElementById('deviceFixture').innerHTML = DeviceList.renderVoiceControlHtml(DeviceList.list[0]);
        });
        const button = '#voiceVadPanel [data-voice-continuous-toggle]';
        const state = () => page.$eval(button, element => ({ text: element.textContent, pressed: element.getAttribute('aria-pressed'),
            disabled: element.disabled, image: getComputedStyle(element).backgroundImage,
            inCard: !!element.closest('.display-vad-card') }));
        assert.equal(await page.$('#deviceFixture [data-voice-continuous-toggle]'), null);
        for (const theme of ['dark', 'light']) {
            await page.evaluate(name => {
                document.documentElement.dataset.theme = name;
                document.documentElement.dataset.themeMode = name;
            }, theme);
            const realtime = await state();
            assert.equal(realtime.text, '实时监听');
            assert.equal(realtime.inCard, true);
            assert.match(realtime.image, /linear-gradient/);
            await page.click(button);
            const waiting = await state();
            assert.equal(waiting.text, '实时监听');
            assert.equal(waiting.disabled, true);
            await page.evaluate(() => {
                const request = window.sent.at(-1);
                DeviceList.handleVoiceContinuousConfig({ ...request, type: 'displayVoiceListeningConfig', success: true });
            });
            const manual = await state();
            assert.equal(manual.text, '单次监听');
            assert.equal(manual.pressed, 'false');
            assert.equal(manual.image, 'none');
            assert.equal(manual.disabled, false);
            await page.screenshot({ path: path.join(cache, `vad-card-${theme}.png`) });
            await page.click(button);
            await page.evaluate(() => {
                const request = window.sent.at(-1);
                DeviceList.handleVoiceContinuousConfig({ ...request, type: 'displayVoiceListeningConfig', success: true });
            });
            assert.equal((await state()).pressed, 'true');
        }
        const focus = await page.evaluate(() => {
            const input = document.querySelector('[data-vad-threshold]');
            input.focus(); input.value = '0.017';
            DeviceList.toggleVoiceContinuous('one');
            DeviceList.renderVoiceVadPanel();
            DeviceList.handleVoiceContinuousConfig({ ...window.sent.at(-1), type: 'displayVoiceListeningConfig', success: true });
            return { same: input === document.querySelector('[data-vad-threshold]'), focused: document.activeElement === input, value: input.value };
        });
        assert.deepEqual(focus, { same: true, focused: true, value: '0.017' });
        assert.equal((await state()).text, '单次监听');
        await page.evaluate(() => {
            window.WebSocketManager.ws.readyState = 3;
            DeviceList.handleVoiceContinuousDisconnected();
        });
        assert.equal((await state()).disabled, true);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});
