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

function inlineFunction(html, name) {
    const start = html.search(new RegExp(`        (?:async )?function ${name}\\(`));
    assert.ok(start >= 0, `${name} 存在`);
    const tail = html.slice(start);
    const end = tail.slice(1).search(/\n        (?:async )?function /u);
    return end < 0 ? tail : tail.slice(0, end + 1);
}

test('浏览器验证真实语音按钮、助手名及重开后隐藏面板的聊天对象', {
    skip: !executablePath, timeout: 45000
}, async (context) => {
    const cache = path.join(os.homedir(), '.cache/aasc-display-voice');
    fs.mkdirSync(cache, { recursive: true });
    const profile = fs.mkdtempSync(path.join(cache, 'browser-'));
    const html = read('display.html');
    const start = html.indexOf('            <label class="display-stage-button display-voice-switch">');
    const end = html.indexOf('        </div>\n        <div id="displayArCalibration"', start);
    const markup = html.slice(start, end);
    const runtimeSource = html.slice(html.indexOf('        function getVoiceInteractionSnapshot()'),
        html.indexOf("        for (const event of ['playing', 'pause', 'ended', 'error'])"));
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
        const fixtureHtml = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>${read('css/theme.css')} ${read('css/display.css')} ${read('css/display-mmd.css')} ${read('css/display-voice-controls.css')} ${read('css/display-chat.css')}</style></head>
            <body><div id="displayStageLayers" class="display-stage-layers">
              <div id="displayMmdLayer" class="display-mmd-layer"></div><div id="displayChatLayer" class="display-chat-layer"></div>
              <div id="displayInteractionLayer" class="display-interaction-layer">${markup}</div>
            </div>
            <script>
                // 使用正式按钮业务与播报处理源码，只模拟设备采集和音频输出。
                window.fixtureActivations = 0;
                window.fixtureCalls = [];
                let voiceContinuousEnabled = true, voiceListeningConfigReady = true, isAlwaysListening = true;
                let manualVoiceRecording = false, manualVoiceRecordingTimer = null, voiceInteractionEpoch = 0;
                let currentVoiceVadRms = 0, lastVoiceAsrText = '', ttsRecordingPaused = false;
                let silenceDetectionRunning = true, silenceStartTime = null, vadNoiseTestActive = false;
                const vadThreshold = 0.1, vadSilenceDurationMs = 500, vadMinSpeechDurationMs = 300;
                const voiceRecognitionRequests = new Map(), remoteTtsPlaybackIds = new Set();
                let displayWs = { readyState: WebSocket.OPEN }, displayId = 'fixture';
                let isListening = true, hasSpeech = false, speechStartTime = null;
                let globalRecordingPaused = false, voiceListeningEnabled = true, voiceSupported = true;
                const currentCapabilities = { voiceRecording: true };
                let voiceRecordingMode = 'asr', displayRecordingSession = null, voiceCooldownUntil = 0;
                const ttsAudio = { paused: true, ended: false };
                let textTtsPlaybackActive = false, pcmCapture = null;
                window.fixturePlay = () => { ttsAudio.paused = false; publishVoiceRuntime(); };
                function stopTtsPlayback() {
                    window.fixtureActivations++;
                    window.fixtureCalls.push('stop');
                    ttsAudio.paused = true;
                }
                function clearRemoteTextPlayback() { textTtsPlaybackActive = false; }
                function resumeVoiceRecordingAfterTts() {}
                function stopVoiceRecording() {
                    isListening = false; manualVoiceRecording = false;
                    pcmCapture = null; hasSpeech = false; speechStartTime = null; silenceStartTime = null;
                    currentVoiceVadRms = 0;
                    clearManualVoiceTimer(); publishVoiceRuntime();
                }
                async function startVoiceRecording() {
                    window.fixtureCalls.push('start'); isListening = true;
                    pcmCapture = { beginSegment() {} }; publishVoiceRuntime();
                }
                function takeRawPcmWav() { return 'wav'; }
                async function sendAudioForRecognition() { window.fixtureCalls.push('recognize'); }
                ${inlineFunction(html, 'handleTTS')}
                ${runtimeSource}
                ${inlineFunction(html, 'handleVoiceVadRms')}
                window.fixtureVad = (rms) => handleVoiceVadRms(rms);
                window.fixtureReadySpeech = () => {
                    hasSpeech = true; speechStartTime = Date.now() - 1000;
                    silenceStartTime = Date.now() - 600; currentVoiceVadRms = 0.01;
                };
            </script>
            <script>${read('js/display-chat.js')}</script>
            <script>${read('js/display-voice-controls.js')}</script>
            <script>${read('js/display-stage.js')}</script></body></html>`;
        await page.setContent(fixtureHtml);
        await page.waitForFunction(() => window.DisplayStage?.getState().initialized);
        await page.evaluate(() => {
            window.DisplayStage.handleServerMessage({ type: 'displayId', id: 'fixture' });
            window.DisplayStage.setTransport((message) => {
                if (message.type === 'tts' && message.action === 'stop') window.fixtureCalls.push('send-stop');
                if (message.type === 'setDisplayVoiceListeningConfig') {
                    queueMicrotask(() => window.DisplayStage.handleServerMessage({
                        type: 'displayVoiceListeningConfig', displayId: 'fixture', enabled: message.enabled, requestId: message.requestId
                    }));
                }
                return true;
            });
        });
        assert.equal(await page.$eval('#displayVoiceActionStatusText', (element) => element.textContent), '助手 · 空闲');
        await page.evaluate(() => {
            window.DisplayStage.handleServerMessage({ type: 'assistantConfig',
                config: { defaultName: '小爱', assistants: [{ name: '小爱' }, { name: '妲己' }] } });
        });
        assert.equal(await page.$eval('#displayVoiceActionStatusText', (element) => element.textContent), '小爱 · 空闲');
        assert.equal(await page.evaluate(() => window.DisplayStage.getState().chatVisible), false);
        assert.equal(await page.$eval('#displayChatLayer', (element) => getComputedStyle(element).display), 'none');
        await page.evaluate(() => window.fixtureVad(0.026));
        assert.equal(await page.$eval('#displayVoiceVadValue', (element) => element.textContent), ' 0.03');
        assert.equal(await page.$eval('#displayVoiceVadValue', (element) => element.hidden), false);
        assert.equal(await page.$eval('#displayVoiceActionStatus', (element) => element.textContent), '小爱 · 空闲 0.03');
        assert.equal(await page.$eval('#displayVoiceVadValue', (element) => element.parentElement.id), 'displayVoiceActionStatus');
        assert.equal(await page.$eval('#displayVoiceVadValue', (element) => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
        const resultText = '识别结果 <img src=x onerror="window.resultInjected=true">\n' + '长文本换行验证'.repeat(25);
        await page.evaluate((text) => updateAsrResultDisplay(text), resultText);
        assert.equal(await page.$eval('#displayVoiceAsrResult', (element) => element.textContent), resultText);
        assert.equal(await page.$eval('#displayVoiceAsrResult', (element) => element.children.length), 0);
        assert.equal(await page.evaluate(() => window.resultInjected), undefined);
        const resultGeometry = await page.evaluate(() => {
            const result = document.getElementById('displayVoiceAsrResult');
            const bounds = result.getBoundingClientRect();
            return { bottom: bounds.bottom, height: bounds.height, scrollHeight: result.scrollHeight,
                statusTop: document.getElementById('displayVoiceActionStatus').getBoundingClientRect().top };
        });
        assert.ok(resultGeometry.bottom <= resultGeometry.statusTop);
        assert.ok(resultGeometry.scrollHeight > resultGeometry.height, '长结果换行并受最大高度限制');
        await page.screenshot({ path: path.join(cache, 'asr-vad-portrait.png') });
        await page.evaluate(() => updateAsrResultDisplay(''));
        await page.evaluate(() => { window.fixturePlay(); window.fixtureCalls = []; });
        assert.equal(await page.$eval('#displayVoiceActionStatusText', (element) => element.textContent), '小爱 · 说话中');
        await page.click('#displayVoiceAction');
        await page.waitForFunction(() => document.getElementById('displayVoiceActionStatusText').textContent === '小爱 · 空闲');
        assert.deepEqual(await page.evaluate(() => window.fixtureCalls), ['stop', 'send-stop']);
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
        await page.waitForFunction(() => document.getElementById('displayVoiceActionStatusText').textContent === '小爱 · 已停止');
        assert.equal(await page.$eval('#displayVoiceVadValue', (element) => element.hidden), true);
        assert.equal(await page.$eval('#displayVoiceContinuous', (element) => element.checked), false);
        await page.evaluate(() => { window.fixturePlay(); window.fixtureCalls = []; });
        await page.click('#displayVoiceAction');
        await page.waitForFunction(() => document.getElementById('displayVoiceActionStatusText').textContent === '小爱 · 监听中');
        assert.equal(await page.evaluate(() => window.DisplayVoiceRuntime.snapshot().manual), true);
        assert.deepEqual(await page.evaluate(() => window.fixtureCalls), ['stop', 'send-stop', 'start']);
        await page.evaluate(() => window.fixtureVad(0.2));
        await page.click('#displayVoiceAction');
        await page.waitForFunction(() => document.getElementById('displayVoiceActionStatusText').textContent === '小爱 · 已停止');
        assert.equal(await page.evaluate(() => window.DisplayVoiceRuntime.snapshot().manual), false);
        assert.equal(await page.evaluate(() => window.fixtureCalls.includes('recognize')), false, '未等待静音的录音立即丢弃');
        await page.click('#displayVoiceAction');
        await page.evaluate(() => window.fixtureReadySpeech());
        await page.click('#displayVoiceAction');
        await page.waitForFunction(() => document.getElementById('displayVoiceActionStatusText').textContent === '小爱 · 已停止');
        assert.equal(await page.evaluate(() => window.fixtureCalls.filter((call) => call === 'recognize').length), 1);
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
        assert.equal(await page.evaluate(() => window.fixtureActivations), 9);
        // 新文档不保留旧页面内存；重新注入服务端持久化快照模拟APK重开。
        for (const selection of [
            { mode: 'private', privateTarget: '妲己', privateSessionId: 'session-2', roleTarget: null },
            { mode: 'role', privateTarget: null, privateSessionId: 'default', roleTarget: '工作助手' }
        ]) {
            await page.goto('about:blank');
            await page.setContent(fixtureHtml);
            await page.waitForFunction(() => window.DisplayStage?.getState().initialized);
            const name = selection.mode === 'private' ? selection.privateTarget : selection.roleTarget;
            await page.evaluate((session) => {
                window.fixtureMessages = [];
                window.DisplayStage.setTransport((message) => { window.fixtureMessages.push(message); return true; });
                window.DisplayStage.handleServerMessage({ type: 'assistantConfig',
                    config: { defaultName: '小爱', assistants: [{ name: '小爱' }, { name: '妲己' }] } });
                window.DisplayStage.handleServerMessage({ type: 'roleList', roles: [{ name: '工作助手' }] });
                window.DisplayStage.handleServerMessage({ type: 'chatSession', session });
            }, selection);
            assert.equal(await page.$eval('#displayVoiceActionStatusText', (element) => element.textContent), name + ' · 空闲');
            assert.equal(await page.evaluate(() => window.DisplayStage.getState().chatVisible), false);
            assert.equal(await page.$eval('#displayChatLayer', (element) => element.getAttribute('aria-hidden')), 'true');
            assert.equal(await page.$eval('[data-role="target-toggle"]', (element) => element.dataset.value),
                selection.mode + ':' + name);
            assert.match(await page.$eval('#displayVoiceAction', (element) => element.getAttribute('aria-label')), new RegExp(name));
            assert.equal(await page.evaluate(() => window.DisplayChat.sendVoiceMessage('重开后输入')), true);
            const message = await page.evaluate(() => window.fixtureMessages.findLast((item) => item.type === 'chatMessage'));
            assert.equal(message.mode, selection.mode);
            assert.equal(message.sessionId, selection.privateSessionId);
            assert.equal(selection.mode === 'role' ? message.role : message.target, name);
        }
        // 当前角色来自权威回包；旧快照缺字段保留已有选择，明确null可以清空。
        await page.evaluate(() => {
            window.DisplayStage.handleServerMessage({ type: 'chatSession', session: { mode: 'role', roleTarget: '另一个角色' } });
            window.DisplayStage.handleServerMessage({ type: 'chatSession', session: { mode: 'role' } });
            window.DisplayStage.handleServerMessage({ type: 'chatResponse', requestId: 'unused', success: true });
        });
        assert.equal(await page.evaluate(() => window.DisplayChat.getVoiceStatusName()), '另一个角色');
        await page.evaluate(() => {
            window.DisplayStage.handleServerMessage({ type: 'chatSession', session: { mode: 'role', roleTarget: null } });
        });
        assert.equal(await page.evaluate(() => window.DisplayChat.getVoiceStatusName()), '小爱');
        const escapedName = '<img src=x onerror="window.nameInjected=true">';
        await page.evaluate((name) => {
            window.DisplayStage.handleServerMessage({ type: 'assistantConfig', config: { defaultName: name } });
        }, escapedName);
        assert.equal(await page.$eval('#displayVoiceActionStatusText', (element) => element.textContent), escapedName + ' · 空闲');
        assert.equal(await page.$eval('#displayVoiceActionStatusText', (element) => element.children.length), 0);
        assert.equal(await page.evaluate(() => window.nameInjected), undefined);
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        fs.rmSync(profile, { recursive: true, force: true });
    }
});
