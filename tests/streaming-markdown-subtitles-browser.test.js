'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'src/apps/web-mediacenter/ui/public');

test('真实浏览器字幕保留Markdown，按实际音频时钟而非标记长度显示', { timeout: 45000 }, async t => {
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<div id="voiceTextDisplay" style="width:280px;font:20px monospace;padding:0"></div>');
    await page.addStyleTag({ path: path.join(publicDir, 'css/display.css') });
    for (const file of ['src/core/utils/sentence-splitter.js', 'src/core/utils/markdown-speech.js',
        'src/apps/web-mediacenter/ui/public/js/chat-markdown.js', 'src/apps/web-mediacenter/ui/public/js/display-lipsync-audio.js',
        'src/apps/web-mediacenter/ui/public/js/display-tts-subtitles.js']) {
        await page.addScriptTag({ path: path.join(root, file) });
    }
    await page.evaluate(() => {
        window.audio = new EventTarget();
        Object.assign(audio, { paused: true, ended: false, duration: 10, currentTime: 0,
            currentSrc: 'https://audio.example/a.wav' });
        window.subtitles = DisplayTtsSubtitles.create({ element: document.getElementById('voiceTextDisplay'), audio, onChange() {} });
        window.begin = (speech, markdown, offset = 0) => {
            Object.assign(audio, { paused: true, ended: false, currentTime: 0 });
            DisplayLipSyncAudio.prepare(audio, speech, audio.currentSrc, null, { markdown, speech, offset });
        };
        window.progress = value => { audio.paused = false; audio.currentTime = value; audio.dispatchEvent(new Event('timeupdate')); };
    });
    await page.evaluate(() => begin('早上好。', '# 今天\n\n**早上好。**后面的句子。', 2));
    assert.equal(await page.$eval('#voiceTextDisplay', e => e.textContent), '', '未实际播放前不提前刷字幕');
    await page.evaluate(() => progress(.1));
    assert.equal(await page.$eval('.tts-subtitle-line', e => e.textContent), '早上好。');
    assert.equal(await page.$eval('.tts-subtitle-line strong', e => e.textContent), '早上好。');
    assert.equal(await page.$eval('#voiceTextDisplay', e => e.textContent.includes('后面的')), false);

    await page.evaluate(() => { begin('帮助可用。', '[帮助](https://example.com)可用。'); progress(.1); });
    assert.equal(await page.$eval('.tts-subtitle-line:last-child a', e => e.textContent), '帮助');
    assert.equal(await page.$eval('.tts-subtitle-line:last-child', e => e.textContent), '帮助可用。');

    await page.evaluate(() => { begin('安全。', '**安全。**<img src=x onerror="window.injection=1"><script>window.injection=1</script>'); progress(.1); });
    assert.equal(await page.evaluate(() => window.injection), undefined);
    assert.equal(await page.$eval('.tts-subtitle-line:last-child', e => e.querySelectorAll('script,img').length), 0);

    await page.evaluate(() => {
        document.getElementById('voiceTextDisplay').style.width = '90px';
        begin('第一行文字第二行文字第三行文字第四行文字。', '**第一行文字第二行文字第三行文字第四行文字。**');
        progress(.1);
    });
    const before = await page.$eval('#voiceTextDisplay', e => e.textContent);
    await page.evaluate(() => { audio.paused = true; audio.currentTime = 8; audio.dispatchEvent(new Event('timeupdate')); });
    assert.equal(await page.$eval('#voiceTextDisplay', e => e.textContent), before, '暂停不能显示后续内容');
    await page.evaluate(() => { audio.paused = false; audio.currentSrc = 'https://audio.example/other.wav'; audio.dispatchEvent(new Event('timeupdate')); });
    assert.equal(await page.$eval('#voiceTextDisplay', e => e.textContent), before, '迟到旧音源不能更新字幕');
    await page.evaluate(() => { audio.currentSrc = 'https://audio.example/a.wav'; progress(8); });
    assert.notEqual(await page.$eval('#voiceTextDisplay', e => e.textContent), before);
    assert.equal(await page.$$eval('.tts-subtitle-line', rows => rows.at(-1).querySelectorAll('strong').length > 0), true);
    await page.evaluate(() => { audio.ended = true; audio.dispatchEvent(new Event('ended')); });
    assert.match(await page.$eval('#voiceTextDisplay', e => e.textContent), /文字。$/);

    await page.evaluate(() => {
        document.getElementById('voiceTextDisplay').style.width = '400px';
        Object.assign(audio, { paused: false, ended: false, currentTime: 0 });
        DisplayLipSyncAudio.prepare(audio, '**旧消息也加粗。**', audio.currentSrc);
        audio.dispatchEvent(new Event('playing'));
    });
    assert.equal(await page.$eval('.tts-subtitle-line:last-child strong', e => e.textContent), '旧消息也加粗。');
    await page.addScriptTag({ path: path.join(publicDir, 'js/self-test.js') });
    const selfCheck = await page.evaluate(() => SelfTest.tests.find(test => test.id === 'chat_streaming_markdown_speech').run());
    assert.equal(selfCheck.success, true);
    assert.deepEqual(errors, []);
});

test('Responses尚未完成时，真实双端聊天DOM和首段TTS已就绪，最终不重复', { timeout: 45000 }, async t => {
    const http = require('node:http');
    const fs = require('node:fs');
    const os = require('node:os');
    const cheerio = require('cheerio');
    const { createResponsesClient } = require('../src/external/llm/llm-responses-client');
    const { runGameAwareChat } = require('../src/apps/server/modules/game/game-chat-bridge');
    const { createGomokuGameService } = require('../src/apps/server/modules/game/gomoku-game-service');
    const { generateChatTtsActions } = require('../src/apps/server/modules/chat/chat-tts-actions');
    const { toSpeechText } = require('../src/core/utils/markdown-speech');
    const { splitIntoSentences } = require('../src/core/utils/sentence-splitter');
    let release;
    const allowed = new Promise(resolve => { release = resolve; });
    let upstreamCompleted = false;
    const server = http.createServer(async (req, res) => {
        let body = ''; for await (const chunk of req) body += chunk;
        assert.equal(JSON.parse(body).stream, true);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const emit = event => res.write('data: ' + JSON.stringify(event) + '\n\n');
        emit({ type: 'response.output_text.delta', delta: '**第一句。**' });
        await allowed;
        emit({ type: 'response.output_text.delta', delta: '第二句。尾段' });
        upstreamCompleted = true;
        emit({ type: 'response.completed', response: { id: 'local-response' } });
        res.end('data: [DONE]\n\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { release(); server.close(); });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-stream-dom-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const display = await browser.newPage();
    const $ = cheerio.load(fs.readFileSync(path.join(publicDir, 'display.html'), 'utf8'));
    $('script, link[rel="stylesheet"]').remove();
    await display.setContent($.html());
    for (const file of ['chat-markdown.js','display-chat.js','display-stage.js']) {
        await display.addScriptTag({ path: path.join(publicDir, 'js', file) });
    }
    await display.evaluate(() => {
        DisplayStage.setTransport(() => true);
        DisplayStage.handleServerMessage({ type: 'chatSession', session: { mode: 'group' } });
        DisplayStage.handleServerMessage({ type: 'chatInput', requestId: 'stream-check', content: '早' });
    });
    const control = await browser.newPage();
    await control.setContent('<div id="chatMessages"><div id="streamingContent"></div></div>');
    for (const file of ['chat-markdown.js', 'chat.js']) await control.addScriptTag({ path: path.join(publicDir, 'js', file) });
    await control.evaluate(() => { Chat.activeRequestId = 'stream-check'; });
    const client = createResponsesClient({ baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
    const deliveries = [], generated = [];
    let firstReady;
    const ready = new Promise(resolve => { firstReady = resolve; });
    const chat = { splitIntoSentences, async chatStream(input, options, callbacks) {
        let message = '';
        await client.stream({ model: 'isolated', input, stream: true }, event => {
            if (event.type === 'response.output_text.delta') {
                message += event.delta; callbacks.onChunk(event.delta, message, '');
            }
        });
        return { success: true, message, speech: message, history: [] };
    } };
    const pending = runGameAwareChat({ chat,
        gameService: createGomokuGameService({ filePath: path.join(dir, 'game.json') }),
        displayId: 'isolated-display', content: '早', options: {}, callbacks: {
            onChunk: (chunk, message, reasoning) => {
                const payload = { type: 'chatChunk', requestId: 'stream-check', chunk, message, reasoning };
                deliveries.push(Promise.all([display.evaluate(p => DisplayStage.handleServerMessage(p), payload),
                    control.evaluate(p => Chat.handleChunk(p), payload)]));
            },
            onSentence: (sentence, _m, _r, _s, _phase, subtitle) => {
                deliveries.push(generateChatTtsActions({ sentence, subtitle, stripMarkdown: toSpeechText, send() {},
                    generate: async text => { generated.push({ text, beforeComplete: !upstreamCompleted }); return 'isolated.wav'; } })
                    .then(result => { if (result) firstReady(); }));
            },
        } });
    await Promise.race([ready, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('首段未在完成前合成')), 8000); timer.unref(); })]);
    await Promise.all(deliveries);
    assert.equal(upstreamCompleted, false);
    assert.equal(generated[0].text, '第一句。');
    assert.equal(generated[0].beforeComplete, true);
    assert.equal(await display.$eval('.display-chat-message.is-assistant strong', e => e.textContent), '第一句。');
    assert.equal(await control.$eval('#streamingContent strong', e => e.textContent), '第一句。');
    release();
    const result = await pending;
    await Promise.all(deliveries);
    assert.equal(result.success, true);
    assert.deepEqual(generated.map(r => r.text), ['第一句。', '第二句。', '尾段']);
    assert.equal(await display.$eval('.display-chat-message.is-assistant .display-chat-message-body', e => e.textContent), '第一句。第二句。尾段');
    assert.match(await control.$eval('#streamingContent', e => e.textContent), /^第一句。第二句。尾段/);
});
