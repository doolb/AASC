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
