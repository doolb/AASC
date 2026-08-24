'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTextPlayerForTest } = require('../src/apps/web-mediacenter/ui/public/js/text-media-player');

test('plain text pagination creates full-screen pages without dropping lines', async () => {
    const player = createTextPlayerForTest({
        width: 800,
        height: 600,
        fontSize: 40,
        lineHeight: 1.6
    });

    await player.loadText('第一行\n第二行\n第三行', 'plain');

    assert.equal(player.getProgress().pageTotal, 1);
    assert.match(player.getPageText(0), /第一行/);
    assert.match(player.getPageText(0), /第二行/);
    assert.match(player.getPageText(0), /第三行/);
});

test('oversized plain line is split across measured pages without losing characters', async () => {
    const text = '这是一个需要在窄屏中自动换页的超长文本行。'.repeat(12);
    const player = createTextPlayerForTest({ width: 160, height: 120, fontSize: 20, lineHeight: 1.5 });

    await player.loadText(text, 'plain');

    assert.ok(player.getProgress().pageTotal > 1);
    assert.equal(
        Array.from({ length: player.getProgress().pageTotal }, (_, index) => player.getPageText(index)).join('').replace(/\n/g, ''),
        text
    );
});

test('next page invalidates the previous playback id and requests the first sentence of the new page', () => {
    const sent = [];
    const player = createTextPlayerForTest({
        send: (message) => sent.push(message),
        pageTexts: ['第一句。', '第二句。']
    });

    player.start();
    const oldPlaybackId = sent[0].playbackId;
    player.handleControl('next');

    assert.notEqual(sent[1].playbackId, oldPlaybackId);
    assert.equal(sent[1].sentenceIndex, 0);
    assert.equal(sent[1].text, '第二句。');
});

test('pause before TTS audio arrives invalidates the pending request and play retries the current sentence', () => {
    const sent = [];
    const player = createTextPlayerForTest({
        send: (message) => sent.push(message),
        pageTexts: ['等待回包时暂停后继续播放。']
    });

    player.start();
    const initialRequest = sent.find((message) => message.type === 'textSentenceTts');
    player.handleControl('pause');
    player.handleControl('play');
    const sentenceRequests = sent.filter((message) => message.type === 'textSentenceTts');

    assert.equal(sentenceRequests.length, 2);
    assert.notEqual(sentenceRequests[1].playbackId, initialRequest.playbackId);
    assert.equal(sentenceRequests[1].pageIndex, initialRequest.pageIndex);
    assert.equal(sentenceRequests[1].sentenceIndex, initialRequest.sentenceIndex);
    assert.equal(sentenceRequests[1].text, initialRequest.text);
});

test('long Markdown paragraphs and lists without blank lines paginate without dropping source text', async () => {
    const paragraph = '这是没有空行分隔的超长 Markdown 段落。'.repeat(24);
    const list = Array.from({ length: 30 }, (_, index) => `- 列表项目 ${index + 1}：内容需要继续分页。`).join('\n');
    const codeBlock = `\`\`\`text\n${Array.from({ length: 20 }, (_, index) => `代码块第 ${index + 1} 行`).join('\n')}\n\`\`\``;
    const text = `${paragraph}\n${list}\n${codeBlock}`;
    const player = createTextPlayerForTest({ width: 160, height: 120, fontSize: 20, lineHeight: 1.5 });

    await player.loadText(text, 'markdown');

    assert.ok(player.getProgress().pageTotal > 1);
    assert.equal(
        Array.from({ length: player.getProgress().pageTotal }, (_, index) => player.getPageText(index)).join('\n').replace(/\n/g, ''),
        text.replace(/\n/g, '')
    );
});

test('pagination uses the already rotated text container dimensions for every right-angle rotation', async () => {
    const text = '旋转后仍需使用显示容器实际尺寸进行分页。'.repeat(48);
    const pageTotals = [];
    const sizes = [
        { rotation: 0, width: 800, height: 600 },
        { rotation: 90, width: 600, height: 800 },
        { rotation: 180, width: 800, height: 600 },
        { rotation: 270, width: 600, height: 800 }
    ];

    for (const size of sizes) {
        const player = createTextPlayerForTest({ ...size, fontSize: 40, lineHeight: 1.6 });
        await player.loadText(text, 'plain');
        pageTotals.push(player.getProgress().pageTotal);
    }

    assert.deepEqual(pageTotals, [9, 8, 9, 8]);
});

test('re-pagination after a rotated container resize keeps the current text anchor', async () => {
    const lines = Array.from({ length: 36 }, (_, index) => `第 ${index + 1} 行内容。`);
    const player = createTextPlayerForTest({ width: 160, height: 120, fontSize: 20, lineHeight: 1.5 });

    await player.loadText(lines.join('\n'), 'plain');
    player.handleControl('next');
    const anchor = player.getPageText(player.getProgress().pageIndex);
    player.configure({ width: 120, height: 160, rotation: 90 });
    player.applyStyle({});

    assert.match(player.getPageText(player.getProgress().pageIndex), new RegExp(anchor.split('\n')[0]));
});

test('tagged audio only advances the matching sentence after audio ends', () => {
    const sent = [];
    const audio = {
        paused: true,
        play: () => Promise.resolve(),
        pause() {},
        addEventListener() {},
        removeEventListener() {}
    };
    const player = createTextPlayerForTest({
        send: (message) => sent.push(message),
        pageTexts: ['第一句。第二句。'],
        audio
    });

    player.start();
    player.handleTtsAudio({ ...sent[0], audioUrl: '/tts/first.wav' });
    player.handleTtsAudio({ ...sent[0], sentenceIndex: 1, audioUrl: '/tts/stale.wav' });
    player.finishCurrentSentence();

    assert.equal(sent.length, 2);
    assert.equal(sent[1].sentenceIndex, 1);
    assert.equal(sent[1].text, '第二句。');
});

test('textSentenceTts 请求携带服务端下发的语音路由目标', () => {
    const sent = [];
    const player = createTextPlayerForTest({
        send: (message) => sent.push(message),
        pageTexts: ['需要远程播报。']
    });

    player.loadRoute({
        selectedDisplayIds: ['source', 'speaker'],
        selectedVoiceDisplayIds: ['speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    player.start();

    assert.equal(sent[0].type, 'textSentenceTts');
    assert.deepEqual(sent[0].route, {
        selectedDisplayIds: ['source', 'speaker'],
        selectedVoiceDisplayIds: ['speaker'],
        voiceTargetDisplayId: 'speaker'
    });
});

test('远程文本播放完成回执按当前句定位推进下一句', () => {
    const sent = [];
    const player = createTextPlayerForTest({
        send: (message) => sent.push(message),
        pageTexts: ['第一句。第二句。']
    });

    player.start();
    player.handleTtsFinished({ ...sent[0], status: 'ended' });

    assert.equal(sent.length, 2);
    assert.equal(sent[1].sentenceIndex, 1);
    assert.equal(sent[1].text, '第二句。');
});

test('远程预取句开始后暂停再恢复会使用新 playbackId 重发当前句', () => {
    const sent = [];
    const player = createTextPlayerForTest({
        send: (message) => sent.push(message),
        pageTexts: ['第一句。第二句。']
    });

    player.loadRoute({
        selectedDisplayIds: ['source', 'speaker'],
        selectedVoiceDisplayIds: ['speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    player.start();
    player.handleTtsReady({ ...sent[0], sentenceIndex: 1, prefetch: true });
    player.finishCurrentSentence();
    const active = sent.at(-1);
    player.handleControl('pause');
    player.handleControl('play');

    const replay = sent.filter((message) => message.type === 'textSentenceTts').at(-1);
    assert.equal(replay.type, 'textSentenceTts');
    assert.notEqual(replay.playbackId, active.playbackId);
    assert.equal(replay.sentenceIndex, 1);
    assert.equal(replay.text, '第二句。');
});

test('当前句音频开始播放后只预取一次下一句', () => {
    const sent = [];
    const audio = {
        paused: true,
        play: () => Promise.resolve(),
        pause() {},
        addEventListener() {},
        removeEventListener() {}
    };
    const player = createTextPlayerForTest({
        send: (message) => sent.push(message),
        pageTexts: ['第一句。第二句。'],
        audio
    });

    player.start();
    player.handleTtsAudio({ ...sent[0], audioUrl: '/tts/first.wav' });
    player.handleTtsAudio({ ...sent[0], audioUrl: '/tts/first-duplicate.wav' });

    const prefetchRequests = sent.filter((message) => message.prefetch === true);
    assert.equal(prefetchRequests.length, 1);
    assert.equal(prefetchRequests[0].sentenceIndex, 1);
    assert.equal(prefetchRequests[0].text, '第二句。');
});

test('预取音频先缓存，当前句结束后消费缓存且不重复普通请求', () => {
    const sent = [];
    const played = [];
    const audio = {
        paused: true,
        set src(value) { played.push(value); },
        get src() { return played.at(-1); },
        play: () => Promise.resolve(),
        pause() {},
        addEventListener() {},
        removeEventListener() {}
    };
    const player = createTextPlayerForTest({
        send: (message) => sent.push(message),
        pageTexts: ['第一句。第二句。'],
        audio
    });

    player.start();
    player.handleTtsAudio({ ...sent[0], audioUrl: '/tts/first.wav' });
    player.handleTtsAudio({ ...sent[1], audioUrl: '/tts/second-prefetch.wav', prefetch: true });

    assert.deepEqual(played, ['/tts/first.wav']);
    player.finishCurrentSentence();

    assert.deepEqual(played, ['/tts/first.wav', '/tts/second-prefetch.wav']);
    assert.equal(sent.filter((message) => message.sentenceIndex === 1 && !message.prefetch).length, 0);
});

test('当前句结束时等待未完成预取，预取失败后回退普通请求', () => {
    const sent = [];
    const audio = {
        paused: true,
        play: () => Promise.resolve(),
        pause() {},
        addEventListener() {},
        removeEventListener() {}
    };
    const player = createTextPlayerForTest({
        send: (message) => sent.push(message),
        pageTexts: ['第一句。第二句。'],
        audio
    });

    player.start();
    player.handleTtsAudio({ ...sent[0], audioUrl: '/tts/first.wav' });
    player.finishCurrentSentence();

    assert.equal(sent.length, 2);
    player.handleTtsError({ ...sent[1], prefetch: true, message: '预取失败' });

    assert.equal(sent.length, 3);
    assert.equal(sent[2].sentenceIndex, 1);
    assert.equal(sent[2].prefetch, undefined);
    assert.equal(sent[2].text, '第二句。');
});

test('切换播放标识后忽略旧预取回包', () => {
    const sent = [];
    const played = [];
    const audio = {
        paused: true,
        set src(value) { played.push(value); },
        get src() { return played.at(-1); },
        play: () => Promise.resolve(),
        pause() {},
        addEventListener() {},
        removeEventListener() {},
        removeAttribute() {}
    };
    const player = createTextPlayerForTest({
        send: (message) => sent.push(message),
        pageTexts: ['第一页第一句。第二句。', '第二页第一句。'],
        audio
    });

    player.start();
    player.handleTtsAudio({ ...sent[0], audioUrl: '/tts/page1-first.wav' });
    const stalePrefetch = { ...sent[1], audioUrl: '/tts/stale-prefetch.wav', prefetch: true };
    player.handleControl('next');
    player.handleTtsAudio(stalePrefetch);

    assert.deepEqual(played, ['/tts/page1-first.wav']);
    assert.equal(sent.at(-1).pageIndex, 1);
    assert.equal(sent.at(-1).sentenceIndex, 0);
});
