const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const puppeteer = require('puppeteer');
const publicDir = path.resolve('src/apps/web-mediacenter/ui/public');
const read = (file) => fs.readFileSync(path.join(publicDir, file), 'utf8');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(), '/usr/bin/chromium']
    .find((file) => file && fs.existsSync(file));

test('浏览器验证语音按钮居中、状态文字在上方、模式切换与旋转点击', {
    skip: !executablePath, timeout: 45000
}, async (context) => {
    const cache = path.join(os.homedir(), '.cache/aasc-display-voice');
    fs.mkdirSync(cache, { recursive: true });
    const profile = fs.mkdtempSync(path.join(cache, 'browser-'));
    const html = read('display.html');
    const start = html.indexOf('            <label class="display-stage-button display-voice-switch">');
    const end = html.indexOf('        </div>\n        <div id="displayArCalibration"', start);
    const markup = html.slice(start, end);
    let browser;
    try {
        try {
            browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: profile,
                env: { ...process.env, TMPDIR: cache }, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        } catch (error) {
            // 启动失败发生在页面执行前；明确记为环境跳过，不吞掉页面和断言错误。
            context.skip(`Chromium 无法启动：${error.message.split('\n')[0]}`);
            return;
        }
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.setViewport({ width: 480, height: 800 });
        await page.setContent(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>${read('css/theme.css')} ${read('css/display.css')} ${read('css/display-mmd.css')} ${read('css/display-voice-controls.css')}</style></head>
            <body><div id="displayStageLayers" class="display-stage-layers">
              <div id="displayMmdLayer"></div><div id="displayChatLayer"></div>
              <div id="displayInteractionLayer" class="display-interaction-layer">${markup}</div>
            </div>
            <script>
                window.fixtureSnapshot = { continuous: true, connected: true, configReady: true, listening: true };
                window.fixtureActivations = 0;
                window.DisplayVoiceRuntime = {
                    snapshot: () => window.fixtureSnapshot,
                    configure: (enabled) => { window.fixtureSnapshot.continuous = enabled; window.fixtureSnapshot.listening = enabled; },
                    activate: async () => { window.fixtureActivations++; }
                };
            </script>
            <script>${read('js/display-voice-controls.js')}</script>
            <script>${read('js/display-stage.js')}</script></body></html>`);
        await page.waitForFunction(() => window.DisplayStage?.getState().initialized);
        await page.evaluate(() => {
            window.DisplayStage.handleServerMessage({ type: 'displayId', id: 'fixture' });
            window.DisplayStage.setTransport((message) => {
                if (message.type === 'setDisplayVoiceListeningConfig') {
                    queueMicrotask(() => window.DisplayStage.handleServerMessage({
                        type: 'displayVoiceListeningConfig', displayId: 'fixture', enabled: message.enabled, requestId: message.requestId
                    }));
                }
                return true;
            });
        });
        assert.equal(await page.$eval('#displayVoiceActionStatus', (element) => element.textContent), '空闲');
        const measure = () => page.evaluate(() => {
            const button = document.getElementById('displayVoiceAction').getBoundingClientRect();
            const label = document.getElementById('displayVoiceActionStatus').getBoundingClientRect();
            return { width: button.width, height: button.height, centerX: button.x + button.width / 2,
                centerY: button.y + button.height / 2, labelBottom: label.bottom, buttonTop: button.top };
        });
        const portrait = await measure();
        assert.ok(Math.abs(portrait.centerX - 240) < 1);
        assert.equal(portrait.width, portrait.height);
        assert.ok(portrait.labelBottom < portrait.buttonTop);
        await page.click('#displayVoiceContinuous');
        await page.waitForFunction(() => document.getElementById('displayVoiceActionStatus').textContent === '已停止');
        assert.equal(await page.$eval('#displayVoiceContinuous', (element) => element.checked), false);
        await page.click('#displayVoiceAction');
        assert.equal(await page.evaluate(() => window.fixtureActivations), 1);
        await page.setViewport({ width: 800, height: 480 });
        for (const angle of [0, 90, 180, 270]) {
            await page.evaluate((rotation) => {
                // 正式页面先写入 currentRotation，再通知舞台；resize 确保视口切换已同步。
                window.currentRotation = rotation;
                window.DisplayStage.setRotation(rotation);
                window.dispatchEvent(new Event('resize'));
            }, angle);
            const geometry = await measure();
            const actual = angle === 90 || angle === 270 ? geometry.centerY : geometry.centerX;
            assert.ok(Math.abs(actual - (angle === 90 || angle === 270 ? 240 : 400)) < 1, `${angle}° ${JSON.stringify(geometry)}`);
            await page.click('#displayVoiceAction');
        }
        assert.equal(await page.evaluate(() => window.fixtureActivations), 5);
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        fs.rmSync(profile, { recursive: true, force: true });
    }
});
