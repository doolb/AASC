'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MpvTextPlayer, RemoteTextVoice } = require('../src/apps/voice-display-node/mpv-text-player');
const { paginate, textAss, readableText } = require('../src/apps/voice-display-node/mpv-text-renderer');
const { NodeMediaController } = require('../src/apps/voice-display-node/media-controller');
const AudioPlayer = require('../src/apps/voice-display-node/audio-player');
const tick = () => new Promise(resolve => setImmediate(resolve));
const document = (text, format = 'plain') => ({ type: 'base64', mediaType: 'text', format, data: Buffer.from(text).toString('base64') });

function fixture(t, extra = {}) {
    const sent = [], frames = [], audio = [], cancelled = [], errors = [];
    let dimensions = { width: 800, height: 600, rotation: 0 };
    const player = new MpvTextPlayer({ send: data => sent.push(data), render: async frame => frames.push(frame),
        dimensions: () => dimensions, serverUrl: 'http://localhost:3000', onError: error => errors.push(error), ...extra });
    player.configureAudio({ play: (url, options) => audio.push({ url, ...options }), cancel: owner => cancelled.push(owner),
        getDisplayId: () => 'node', voiceEnabled: () => true });
    t.after(() => player.close());
    return { player, sent, frames, audio, cancelled, errors, resize: value => { dimensions = { ...dimensions, ...value }; },
        request: () => sent.filter(data => data.type === 'textSentenceTts').at(-1),
        reply: request => player.handleMessage({ ...request, type: 'tts', action: 'playAudio', textPlayback: true, audioUrl: '/voice.wav' }) };
}

test('中文长文逐字保留，分页负载有界，四方向ASS转义和页码独立于信息层', () => {
    const source = ('中文😀e\u0301 {\\pos(0,0)}\\N\t\n' + '长'.repeat(150) + '\n').repeat(200);
    for (const rotation of [0, 90, 180, 270]) {
        const layout = paginate(source, { width: 800, height: 600, rotation });
        assert.equal(layout.pages.map(page => page.text).join(''), source);
        assert.ok(layout.pages.length > 20);
        let end = 0;
        for (const [pageIndex, page] of layout.pages.entries()) {
            assert.equal(page.start, end); end = page.end;
            assert.ok(Array.from(page.text).length <= 2048);
            const ass = textAss({ layout, pageIndex });
            assert.equal(ass.id, 41); assert.equal(ass.z, 0);
            assert.match(ass.data, new RegExp(`\\\\frz${-rotation}`));
            assert.ok(!ass.data.includes('{\\pos(0,0)}'), '正文指令必须转义');
            assert.ok(ass.data.includes(`${pageIndex + 1} / ${layout.pages.length}`));
        }
        assert.equal(end, source.length);
    }
    assert.equal(readableText('# 标题\n**正文** [链接](https://example.com)\n<script>文本</script>', 'markdown'), '标题\n正文 链接\n文本');
    for (const content of ['', '\n'.repeat(100), '中'.repeat(10000), 'a'.repeat(10000), 'W'.repeat(10000)]) {
        const layout = paginate(content, { width: 300, height: 240 });
        assert.equal(layout.pages.map(page => page.text).join(''), content);
    }
});

test('逐句播放、暂停恢复重播当前句、重复及旧回包隔离、末页完成', async t => {
    const f = fixture(t);
    await f.player.load(document('第一句。第二句。'));
    const first = f.request(); f.reply(first);
    assert.equal(f.audio.length, 1);
    f.reply(first); assert.equal(f.audio.length, 1);
    await f.player.control('pause');
    assert.ok(f.cancelled.includes(`text:${first.playbackId}`));
    f.audio[0].onComplete(); f.reply(first);
    assert.equal(f.player.sentenceIndex, 0);
    await f.player.control('play');
    const resumed = f.request();
    assert.notEqual(resumed.playbackId, first.playbackId); assert.equal(resumed.sentenceIndex, 0);
    f.reply(resumed); f.audio.at(-1).onComplete(); await tick();
    const second = f.request(); assert.equal(second.sentenceIndex, 1);
    f.reply(second); f.audio.at(-1).onComplete(); await tick();
    assert.equal(f.player.state, 'finished');
    assert.equal(f.sent.filter(data => data.type === 'textProgress').at(-1).state, 'finished');
    await f.player.load(document('声音关闭后重新路由。'));
    const local = f.request(); f.reply(local);
    f.player.voiceCapabilityChanged(false);
    assert.notEqual(f.request().playbackId, local.playbackId);
    assert.equal(f.player.sentenceIndex, 0);
});

test('翻页、样式和旋转重排保留页锚点，暂停恢复优先专用文本进度', async t => {
    const f = fixture(t);
    await f.player.load(document('段落内容。'.repeat(1200)), { paused: true, progress: { pageIndex: 3, sentenceIndex: 2 } });
    assert.equal(f.player.pageIndex, 3); assert.equal(f.player.sentenceIndex, 2);
    assert.equal(f.player.state, 'paused'); assert.equal(f.request(), undefined);
    const anchor = f.player.layout.pages[3].start;
    f.resize({ rotation: 90 }); await f.player.reflow({ fontSize: 'small', color: '#123456' });
    const page = f.player.layout.pages[f.player.pageIndex];
    assert.ok(page.start <= anchor && page.end > anchor); assert.equal(f.player.state, 'paused');
    assert.equal(f.player.layout.style.color, '#123456');
    await f.player.control('next'); assert.equal(f.player.state, 'playing'); assert.equal(f.player.sentenceIndex, 0);
    await f.player.control('stop'); assert.equal(f.player.state, 'stopped'); assert.ok(f.frames.at(-1));
    await f.player.clear(); assert.equal(f.frames.at(-1), null);
});

test('清空取消下载，延迟文档不会覆盖新文档，暂停可在下载中生效，URL回退与大小报错', async t => {
    let finish;
    let signal;
    const f = fixture(t, { fetchText: (url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); } });
    const old = f.player.load({ type: 'url', mediaType: 'text', url: '/old.txt' });
    await f.player.control('pause');
    finish({ ok: true, headers: { get: () => null }, arrayBuffer: async () => Buffer.from('下载中的暂停。') });
    await old; assert.equal(f.player.state, 'paused');
    const stale = f.player.load({ type: 'url', mediaType: 'text', url: '/old.txt' });
    const oldFinish = finish;
    await f.player.clear(); assert.equal(signal.aborted, true);
    await f.player.load(document('新内容'), { paused: true });
    oldFinish({ ok: true, headers: { get: () => null }, arrayBuffer: async () => Buffer.from('旧内容') });
    assert.equal(await stale, false); assert.equal(f.player.content, '新内容');
    const urls = [];
    f.player.fetchText = async url => { urls.push(url); return { ok: urls.length > 1, status: 404, headers: { get: () => null },
        arrayBuffer: async () => Buffer.from('# 回退成功') }; };
    await f.player.load({ type: 'url', mediaType: 'text', url: '/bad', fallbackUrl: '/ok', format: 'markdown' }, { paused: true });
    assert.deepEqual(urls, ['http://localhost:3000/bad', 'http://localhost:3000/ok']); assert.equal(f.player.content, '回退成功');
    await assert.rejects(f.player.load(document('x'.repeat(8 * 1024 * 1024 + 1))), /8MiB/);
    await assert.rejects(f.player.load({ type: 'base64', data: '%bad' }), /base64/);
    assert.equal(f.frames.at(-1), null); assert.equal(f.player.state, 'error');
});

test('断线使在途文档失效，不再绘制；TTS失败只跳过该句', async t => {
    let finish;
    const f = fixture(t, { fetchText: () => new Promise(resolve => { finish = resolve; }) });
    const loading = f.player.load({ type: 'url', mediaType: 'text', url: '/late.txt' });
    f.player.suspend();
    finish({ ok: true, headers: { get: () => null }, arrayBuffer: async () => Buffer.from('迟到内容') });
    assert.equal(await loading, false); assert.equal(f.frames.length, 0);
    await f.player.load(document('失败句。成功句。'));
    f.player.handleMessage({ ...f.request(), type: 'textSentenceTtsError', message: '合成失败' });
    await tick();
    assert.equal(f.player.sentenceIndex, 1); assert.equal(f.player.state, 'playing'); assert.equal(f.errors.length, 1);
});

test('远端回执推进源文档，无可用语音时启用阅读计时，暂停清理计时器', async t => {
    const f = fixture(t);
    await f.player.load(document('远端一句。下一句。'));
    const first = f.request();
    f.player.handleMessage({ ...first, type: 'textSentenceTtsFinished', originDisplayId: 'other', status: 'ended' });
    assert.equal(f.player.sentenceIndex, 0);
    f.player.handleMessage({ ...first, type: 'textSentenceTtsFinished', originDisplayId: 'node', status: 'ended' });
    await tick(); assert.equal(f.player.sentenceIndex, 1);
    f.player.handleMessage({ ...f.request(), type: 'textSentenceTtsError', errorCode: 'noVoicePlaybackDevice' });
    assert.ok(f.player.timer); assert.equal(f.player.state, 'playing');
    await f.player.control('pause'); assert.equal(f.player.expected, null);
    assert.equal(f.errors.length, 0);
});

test('远端语音只接受本机目标并回执，取消和延迟完成不误停普通TTS，预取不提前播放', () => {
    const sent = [], audio = [], cancelled = [];
    const voice = new RemoteTextVoice(data => sent.push(data));
    voice.configure({ play: (url, options) => audio.push({ url, ...options }), cancel: owner => cancelled.push(owner),
        getDisplayId: () => 'speaker', voiceEnabled: () => true });
    const message = { type: 'tts', action: 'playAudio', textPlaybackRemote: true, originDisplayId: 'source',
        voiceTargetDisplayId: 'speaker', playbackId: 'one', pageIndex: 0, sentenceIndex: 0, audioUrl: '/one.wav' };
    voice.handle({ ...message, voiceTargetDisplayId: 'wrong' }); assert.equal(audio.length, 0);
    voice.handle(message); voice.handle(message); assert.equal(audio.length, 1);
    voice.handle({ ...message, sentenceIndex: 1, prefetch: true }); assert.equal(audio.length, 1);
    audio[0].onComplete(); assert.equal(sent.at(-1).status, 'ended'); assert.equal(audio.length, 2);
    voice.handle({ ...message, action: 'stop' }); audio[1].onComplete(); voice.handle(message);
    assert.equal(sent.length, 1); assert.equal(audio.length, 2);
    assert.ok(cancelled.every(owner => owner.startsWith('remote:'))); voice.stop();
});

test('按owner取消正在播放及排队朗读，普通TTS继续且整队列录音回调只触发一次', async () => {
    const player = new AudioPlayer();
    const started = [], completed = [], releases = [];
    let starts = 0, ends = 0;
    player.onPlayStart = () => starts++; player.onPlayEnd = () => ends++;
    player.playWavBuffer = async () => {
        const item = player.currentQueueItem; started.push(item.owner);
        await new Promise(resolve => { releases.push(resolve); player.currentProcess = { kill: resolve }; });
        player.currentProcess = null;
    };
    player.queueBuffer(Buffer.from('a'), { owner: 'text:one', onComplete: () => completed.push('cancelled') });
    player.queueBuffer(Buffer.from('b'), { owner: 'ordinary', onComplete: () => completed.push('ordinary') });
    player.queueBuffer(Buffer.from('c'), { owner: 'text:one', onComplete: () => completed.push('queued-cancelled') });
    player.cancelOwner('text:one'); await tick();
    assert.deepEqual(started, ['text:one', 'ordinary']); assert.equal(ends, 0);
    releases.at(-1)(); await tick();
    assert.deepEqual(completed, ['ordinary']); assert.equal(starts, 1); assert.equal(ends, 1);
});

test('媒体控制器文本能力门控、恢复进度、原生进度隔离和切回普通媒体', async t => {
    class Player extends EventEmitter {
        async checkAvailable() { return true; }
        async clear() {} async ensureStarted() {} async control() {} async close() {}
        async setOverlayEnabled() {} async setTextPage(page) { this.page = page; }
        textDimensions() { return { width: 800, height: 600 }; }
        async load(media) { this.native = media; return true; }
    }
    const player = new Player(), sent = [];
    const controller = new NodeMediaController({ serverUrl: 'http://localhost' }, { player, send: data => sent.push(data) });
    t.after(() => controller.close());
    await controller.initialize();
    await controller.setCapabilities({ mediaRendering: true, displayText: false });
    assert.equal(await controller.handleMedia(document('内容')), false); assert.equal(sent.at(-1).success, false);
    await controller.setCapabilities({ mediaRendering: true, displayText: true });
    await controller.restore({ currentMedia: document('句子。'.repeat(1000)), currentTextProgress: { pageIndex: 2, sentenceIndex: 1 },
        currentMediaProgress: { pageIndex: 0 }, isPlaying: false, textStyle: { fontSize: 'small' } });
    assert.equal(controller.text.pageIndex, 2); assert.equal(controller.text.sentenceIndex, 1);
    assert.equal(controller.text.state, 'paused');
    const count = sent.length; player.emit('progress', { mediaType: 'video', isPlaying: true, currentTime: 10 });
    assert.equal(sent.length, count);
    await controller.handleMedia({ type: 'url', mediaType: 'video', url: '/video.mp4' });
    assert.equal(player.page, null); assert.equal(controller.text.active, false); assert.equal(player.native.mediaType, 'video');
});

test('清空正文的IPC尚未回执时，新原生媒体不被迟到清空覆盖', async t => {
    class Player extends EventEmitter {
        async checkAvailable() { return true; }
        async setOverlayEnabled() {} async close() {}
        async clear() { this.current = null; }
        control() { return this.clear(); }
        async load(media) { this.current = media; return true; }
        setTextPage() {
            if (this.defer) { this.defer = false; return new Promise(resolve => { this.release = resolve; }); }
            return Promise.resolve();
        }
    }
    const player = new Player();
    const controller = new NodeMediaController({}, { player });
    t.after(() => controller.close());
    await controller.initialize(); await controller.setCapabilities({ mediaRendering: true });
    player.defer = true;
    const clear = controller.handleControl({ action: 'clearMedia' });
    await controller.handleMedia({ type: 'url', mediaType: 'video', url: '/new.mp4' });
    player.release(); await clear;
    assert.equal(player.current.url, '/new.mp4');
});
