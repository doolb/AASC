'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const { createTextPlayerForTest } = require('../src/apps/web-mediacenter/ui/public/js/text-media-player');

const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const read = (name) => fs.readFileSync(path.join(publicDir, name), 'utf8');
const server = fs.readFileSync(path.resolve(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
// 按真实文件的函数缩进取声明，执行正式实现而非维护第二套清空逻辑。
function declaration(source, name, indent = '') {
    const pattern = new RegExp(`(?:async )?function ${name}\\([^]*?\\n${indent}\\}`);
    const match = source.match(pattern);
    assert.ok(match, `应找到正式函数 ${name}`);
    return match[0];
}
function strippedHtml(name) {
    const $ = cheerio.load(read(name));
    $('script, link[rel="stylesheet"]').remove();
    if (name === 'upload.html') $('head').append(`<style>${read('css/upload.css')}</style>`);
    return $.html();
}

test('服务端清空保存状态、取消文本路由并只下发所选显示端', async () => {
    const state = { currentMedia: { url: '/old.png' }, currentPlaylist: { listId: 'old' },
        currentMediaProgress: { currentTime: 20 }, currentTextProgress: { pageIndex: 3 },
        lastTempMedia: { fileName: 'temp' }, isPlaying: true, mmdVisible: true, volume: 70 };
    const other = { state: { currentMedia: { url: '/other.png' } } };
    const events = [];
    const responses = [];
    let saveFails = false;
    const ctx = vm.createContext({ displayVoiceListeningConfig: { handle: () => false },
        displayClients: new Map([['target', { displayId: 'target', state }], ['other', other]]),
        persistDisplayState(display, patch) {
            if (saveFails) throw new Error('save failed');
            events.push(['save', display.displayId, structuredClone(patch)]);
        },
        textMediaTtsService: { clearDisplayRoute: (id) => events.push(['cancel', id]) },
        sendToDisplay: (id, message) => events.push(['send', id, structuredClone(message)]),
        broadcastToControls: (message) => responses.push(structuredClone(message)), logError() {}
    });
    vm.runInContext(declaration(server, 'handleControlMessageFallback'), ctx);
    const ws = { send: (json) => responses.push(JSON.parse(json)) };
    const command = { type: 'control', displayId: 'target', action: 'clearMedia' };
    await ctx.handleControlMessageFallback(command, ws);
    assert.deepEqual(events.map((item) => item[0]), ['save', 'cancel', 'send']);
    assert.equal(events[2][1], 'target');
    assert.deepEqual(events[2][2], { type: 'control', action: 'clearMedia' });
    for (const name of ['currentMedia', 'currentPlaylist', 'currentMediaProgress', 'currentTextProgress', 'lastTempMedia']) {
        assert.equal(state[name], null, name);
        assert.equal(events[0][2][name], null, `${name}必须持久化`);
    }
    assert.equal(state.isPlaying, false);
    assert.equal(state.mmdVisible, true);
    assert.equal(state.volume, 70);
    assert.equal(other.state.currentMedia.url, '/other.png');
    assert.deepEqual(responses.at(-1), { type: 'mediaClearResult', displayId: 'target', success: true });
    await ctx.handleControlMessageFallback(command, ws);
    assert.equal(state.currentMedia, null, '重复清空保持空状态');
    await ctx.handleControlMessageFallback({ ...command, displayId: 'offline' }, ws);
    assert.equal(responses.at(-1).success, false);
    state.currentMedia = { url: '/new.png' };
    const sentBeforeFailure = events.length;
    saveFails = true;
    await ctx.handleControlMessageFallback(command, ws);
    assert.equal(responses.at(-1).success, false);
    assert.equal(events.length, sentBeforeFailure);
    assert.equal(state.currentMedia.url, '/new.png', '保存失败保留旧媒体');
});

test('严格保存写盘失败恢复旧表，成功后可从磁盘恢复空媒体', (t) => {
    const DataSnapshot = require('../src/core/data-snapshot/DataSnapshot');
    const cache = fs.mkdtempSync(path.join(process.env.TMPDIR || require('node:os').tmpdir(), 'aasc-media-clear-'));
    t.after(() => fs.rmSync(cache, { recursive: true, force: true }));
    const file = path.join(cache, 'user.json');
    fs.writeFileSync(file, JSON.stringify({ displayStates: {
        target: { displayId: 'target', currentMedia: { url: '/old.png' }, isPlaying: true },
        other: { displayId: 'other', currentMedia: { url: '/other.png' } }
    } }));
    const source = fs.readFileSync(path.resolve(__dirname, '../src/apps/server/modules/config/config-app-service.js'), 'utf8');
    const ctx = vm.createContext({ DataSnapshot, defaultDisplayState: {} });
    vm.runInContext(source.match(/class UserConfig extends DataSnapshot[^]*?\n\}/)[0] + '\nglobalThis.UserConfig = UserConfig;', ctx);
    const config = new ctx.UserConfig(file);
    const before = fs.readFileSync(file, 'utf8');
    const save = config._save;
    config._save = () => false;
    assert.throws(() => config.updateDisplayStateById('target', null, { currentMedia: null }, { requireSave: true }), /保存失败/u);
    assert.equal(config.getDisplayStateById('target').currentMedia.url, '/old.png');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    config._save = save;
    config.updateDisplayStateById('target', null, { currentMedia: null, isPlaying: false }, { requireSave: true });
    const restored = new ctx.UserConfig(file);
    assert.equal(restored.getDisplayStateById('target').currentMedia, null);
    assert.equal(restored.getDisplayStateById('target').isPlaying, false);
    assert.equal(restored.getDisplayStateById('other').currentMedia.url, '/other.png');
});

test('清空后迟到的媒体与文本进度不能覆盖空状态或恢复面板', () => {
    const state = { currentMedia: null, currentPlaylist: null, isPlaying: false };
    const ctx = vm.createContext({ displayVoiceListeningConfig: { handle: () => false },
        displayClients: new Map([['target', { state }]]) });
    vm.runInContext(declaration(server, 'handleDisplayMessageFallback'), ctx);
    for (const type of ['videoProgress', 'audioProgress', 'htmlProgress', 'playlistProgress',
        'tempMediaInfo', 'textProgress', 'playStateReport']) {
        // 在途进度必须提前返回；未提供下游依赖，若误入处理分支测试会立即失败。
        ctx.handleDisplayMessageFallback('target', { type, isPlaying: true, state: 'playing', currentTime: 99 }, {});
    }
    assert.deepEqual(state, { currentMedia: null, currentPlaylist: null, isPlaying: false });
});

test('文本清空释放页句缓存、取消网络加载并拒绝旧TTS回包', async () => {
    const sent = [];
    let finishFetch;
    let signal;
    const player = createTextPlayerForTest({ send: (message) => sent.push(message),
        fetch: (_url, options) => { signal = options.signal;
            return new Promise((resolve) => { finishFetch = resolve; }); }
    });
    await player.loadText('旧文本');
    player.start();
    const oldSentence = sent.find((message) => message.type === 'textSentenceTts');
    const pending = player.load({ type: 'url', mediaType: 'text', url: '/late.txt' });
    player.clear();
    assert.equal(signal.aborted, true);
    finishFetch({ ok: true, text: async () => '迟到的旧文本' });
    await pending;
    assert.equal(player.getProgress().pageTotal, 0);
    assert.equal(player.getProgress().sentenceTotal, 0);
    assert.equal(player.getProgress().state, 'stopped');
    assert.equal(player.getPageText(0), '');
    const count = sent.filter((message) => message.type === 'textSentenceTts').length;
    player.handleTtsAudio({ ...oldSentence, audioUrl: '/old.wav' });
    player.handleControl('play');
    assert.equal(sent.filter((message) => message.type === 'textSentenceTts').length, count);
    player.clear();
});

test('清空图片或待加载文本不打断共享音频上的聊天播报', async () => {
    let pauses = 0;
    const audio = { src: '/chat.wav', pause: () => { pauses++; }, removeAttribute() { this.src = ''; } };
    const player = createTextPlayerForTest({ audio });
    await player.loadText('尚未收到音频的文本');
    player.clear();
    assert.equal(pauses, 0);
    assert.equal(audio.src, '/chat.wav');
});

test('真实快捷按钮发送选中目标，权威结果与空快照清理正式面板', {
    skip: !fs.existsSync(chrome), timeout: 30000
}, async (t) => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width: 390, height: 740 });
    await page.setContent(strippedHtml('upload.html'));
    for (const name of ['floating-control', 'controls', 'crop', 'media-library', 'websocket']) {
        await page.addScriptTag({ path: path.join(publicDir, `js/${name}.js`) });
    }
    await page.evaluate(() => {
        window.sent = []; window.toasts = [];
        window.showToast = (...args) => window.toasts.push(args);
        window.currentDisplayId = 'target';
        window.FloatingControl.selectedDisplayId = 'target';
        window.WebSocketManager.ws = { readyState: 1, send: (data) => window.sent.push(JSON.parse(data)) };
        window.FloatingControl.toggle();
        window.FloatingControl.setPlayingState(true);
    });
    const selector = '#floatingClearMediaBtn';
    assert.equal(await page.$eval(selector, (node) => node.previousElementSibling.id), 'floatingPlayPauseBtn');
    await page.click(selector);
    assert.deepEqual(await page.evaluate(() => window.sent), [{ type: 'control', displayId: 'target', action: 'clearMedia' }]);
    assert.equal(await page.$eval('#floatingPlayPauseBtn', (node) => node.textContent), '暂停');
    await page.evaluate(() => {
        window.WebSocketManager.handleMessage({ type: 'mediaClearResult', displayId: 'other', success: true });
        window.WebSocketManager.handleMessage({ type: 'mediaClearResult', displayId: 'target', success: false, message: '保存失败' });
    });
    assert.equal(await page.$eval('#floatingPlayPauseBtn', (node) => node.textContent), '暂停');
    await page.evaluate(() => {
        window.Controls.setPlayingState(true);
        window.Crop.showPreview('data:image/png;base64,iVBORw0KGgo=', 'image');
        document.getElementById('progressSlider').value = 80;
        document.getElementById('progressValue').textContent = '80%';
        document.getElementById('floatingPlaylistStatus').style.display = 'block';
        window.FloatingControl.updateTextPlaybackStatus({ state: 'playing', pageIndex: 1, pageTotal: 3 });
        window.MediaLibrary.currentMediaUrl = '/old.png';
        window.MediaLibrary.tempPlaylistFiles = [{ data: 'old' }];
        window.currentHtmlPlaying = true;
        window.WebSocketManager.handleMessage({ type: 'mediaClearResult', displayId: 'target', success: true });
    });
    const clean = await page.evaluate(() => ({ text: document.getElementById('floatingPlayPauseBtn').textContent,
        progress: document.getElementById('progressSlider').value, current: window.Crop.currentMedia,
        source: window.Crop.previewImg.getAttribute('src'), box: window.Crop.box.style.display,
        library: window.MediaLibrary.currentMediaUrl, temp: window.MediaLibrary.tempPlaylistFiles,
        playlist: document.getElementById('floatingPlaylistStatus').style.display,
        pages: document.getElementById('floatingTextPlaybackStatus').textContent, html: window.currentHtmlPlaying }));
    assert.deepEqual(clean, { text: '播放', progress: '0', current: null, source: null, box: 'none',
        library: null, temp: null, playlist: 'none', pages: '未播放文本', html: false });
    await page.evaluate(() => {
        window.FloatingControl.setPlayingState(true);
        window.WebSocketManager.handleMessage({ type: 'displayState', displayId: 'target',
            state: { currentMedia: null, currentPlaylist: null, crop: { x: 0, y: 0, width: 100, height: 100 } } });
    });
    assert.equal(await page.$eval('#floatingPlayPauseBtn', (node) => node.textContent), '播放');
    for (const condition of ['missing', 'disconnected', 'send-failed']) {
        const count = await page.evaluate(() => window.sent.length);
        await page.evaluate((value) => {
            window.FloatingControl.selectedDisplayId = value === 'missing' ? null : 'target';
            window.WebSocketManager.ws.readyState = value === 'disconnected' ? 3 : 1;
            if (value === 'send-failed') window.WebSocketManager.ws.send = () => { throw new Error('closed'); };
        }, condition);
        await page.click(selector);
        assert.equal(await page.evaluate(() => window.sent.length), count);
    }
    assert.equal(await page.evaluate(() => window.toasts.at(-1)[1]), 'error');
    assert.deepEqual(errors, []);
});

test('真实媒体元素清空五种媒体，停止列表并阻止旧MHTML回填', {
    skip: !fs.existsSync(chrome), timeout: 30000
}, async (t) => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(strippedHtml('display.html'));
    await page.addScriptTag({ path: path.join(publicDir, 'js/text-media-player.js') });
    const source = read('display.html');
    const functions = ['stopPlaylist', 'setMediaSourceWithFallback', 'loadMhtmlMedia', 'showMedia',
        'getCurrentPlayableMedia', 'reportPlayState', 'clearCurrentMedia', 'handleControl', 'handleRestoreState']
        .map((name) => declaration(source, name, '        ')).join('\n');
    await page.addScriptTag({ content: `
        const [mediaImage, mediaVideo, mediaAudio, mediaHtml, mediaText, fileNameDisplay, waitingMessage] =
            ['mediaImage', 'mediaVideo', 'mediaAudio', 'mediaHtml', 'mediaText', 'fileNameDisplay', 'waitingMessage'].map(id => document.getElementById(id));
        const TextMediaPlayer = window.TextMediaPlayer;
        let currentMediaType = null, mediaLoadSequence = 0, htmlMediaAbortController = null;
        let playlistState = null, savedAutoTts = null, autoTtsEnabled = false;
        let pauseExpected = true, mediaIsPlaying = false, mediaRecoveryAttempts = 0, mediaRecoveryTimer = null;
        let controlModeEnabled = true, currentHtmlScroll = {}, htmlProgressTimer = null;
        window.reports = []; window.advanced = 0;
        const displayWs = { readyState: 1, send: json => window.reports.push(JSON.parse(json)) };
        const activateTemporarily = () => {}, stopDynamicFit = () => {}, restartDynamicFitAfterMediaLoad = () => {};
        const stopControlScreenshot = () => {}, announceAndReport = () => {}, isSleepPaused = () => false;
        const stopHtmlScroll = () => { clearInterval(htmlProgressTimer); htmlProgressTimer = null; };
        const startHtmlScroll = () => {}, reportHtmlProgress = () => {};
        const playVideoAuto = () => Promise.resolve(true), playAudioAuto = () => Promise.resolve(true);
        const applyResumeTime = () => {}, mhtmlToHtml = text => text;
        TextMediaPlayer.configure({ send: message => window.reports.push(message) });
        ${functions}
        window.testShow = data => showMedia(data, true, true);
        window.testClear = () => handleControl({ action: 'clearMedia' });
        window.testRestore = state => handleRestoreState(state);
        window.testState = () => ({ type: currentMediaType, playing: mediaIsPlaying, playlist: playlistState,
            text: TextMediaPlayer.getProgress(), filename: fileNameDisplay.textContent });
        window.startTestPlaylist = () => { playlistState = { active: true,
            timer: setTimeout(() => window.advanced++, 20), videoEndedHandler: () => window.advanced++ };
            mediaVideo.addEventListener('ended', playlistState.videoEndedHandler); };
    ` });
    for (const mediaType of ['image', 'video', 'audio', 'html', 'text']) {
        await page.evaluate((type) => {
            window.testShow({ type: 'base64', mediaType: type, mimeType: 'application/octet-stream',
                data: btoa('old-media'), fileName: 'old-file' });
            window.startTestPlaylist();
            window.testClear();
            document.getElementById('mediaVideo').dispatchEvent(new Event('ended'));
        }, mediaType);
        const result = await page.evaluate(() => ({ ...window.testState(), elements:
            ['mediaImage', 'mediaVideo', 'mediaAudio', 'mediaHtml', 'mediaText'].map((id) => ({ id,
                hidden: document.getElementById(id).style.display === 'none',
                source: document.getElementById(id).getAttribute('src') })) }));
        assert.equal(result.type, null);
        assert.equal(result.playing, false);
        assert.equal(result.playlist, null);
        assert.equal(result.text.pageTotal, 0);
        assert.equal(result.filename, '');
        assert.ok(result.elements.every((node) => node.hidden && (node.source === null || node.source === 'about:blank')));
    }
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
    assert.equal(await page.evaluate(() => window.advanced), 0);
    await page.evaluate(() => {
        window.fetch = () => new Promise((resolve) => { window.finishOldFetch = resolve; });
        window.testShow({ type: 'url', mediaType: 'html', url: '/old.mhtml' });
        window.testClear();
        window.testShow({ type: 'base64', mediaType: 'image', data: 'AA==', mimeType: 'image/png', fileName: 'new-image' });
        window.finishOldFetch({ ok: true, text: async () => '旧MHTML回填' });
    });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 20)));
    assert.equal(await page.$eval('#mediaHtml', (node) => node.style.display), 'none');
    assert.equal(await page.$eval('#mediaHtml', (node) => node.srcdoc.includes('旧MHTML回填')), false);
    assert.equal((await page.evaluate(() => window.testState())).filename, 'new-image');
    await page.evaluate(() => window.testRestore({ currentMedia: null, currentPlaylist: null }));
    assert.equal((await page.evaluate(() => window.testState())).type, null);
    assert.equal(await page.$eval('#mediaImage', (node) => node.getAttribute('src')), null);
});
