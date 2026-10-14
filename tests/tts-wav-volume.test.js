'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ttsWav = require('../src/external/tts/tts-wav');

function duration(wav) {
    const { format, samples } = ttsWav.validateWav(wav);
    const sampleRate = format.readUInt32LE(4);
    const blockAlign = format.readUInt16LE(12);
    return samples.length / blockAlign / sampleRate;
}

test('WAV音量后处理只改变样本幅值，不改变样本数、采样率或时长', () => {
    const pcm = Buffer.alloc(8);
    [1000, -1000, 300, -300].forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
    const original = ttsWav.wrapPcm(pcm, 16000);
    const adjusted = ttsWav.adjustWavVolume(original, 50);
    const before = ttsWav.validateWav(original);
    const after = ttsWav.validateWav(adjusted);

    assert.equal(after.samples.length, before.samples.length);
    assert.equal(after.format.readUInt32LE(4), before.format.readUInt32LE(4));
    assert.equal(duration(adjusted), duration(original));
    assert.deepEqual([0, 1, 2, 3].map(index => after.samples.readInt16LE(index * 2)), [500, -500, 150, -150]);
    assert.equal(ttsWav.adjustWavVolume(original, 100), original);
});

test('WAV模块没有变速接口，音量值保持范围校验', () => {
    assert.equal(Object.hasOwn(ttsWav, 'adjustWav'), false);
    const original = ttsWav.wrapPcm(Buffer.from([1, 0]));
    for (const volume of [-1, 101, Number.NaN, Infinity]) {
        assert.throws(() => ttsWav.adjustWavVolume(original, volume), /音量超出范围/u);
    }
});
