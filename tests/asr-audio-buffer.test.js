'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { readWavFileFromBuffer } = require('../src/external/asr/asr-service');

const createPcm16Wav = (samples, sampleRate = 16000) => {
    const dataSize = samples.length * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0, 'ascii');
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8, 'ascii');
    buffer.write('fmt ', 12, 'ascii');
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36, 'ascii');
    buffer.writeUInt32LE(dataSize, 40);
    samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * 2));
    return buffer;
};

test('ASR 可以直接解析内存中的 PCM16 WAV Buffer', () => {
    const wav = createPcm16Wav([0, 16384, -16384], 16000);
    const result = readWavFileFromBuffer(wav);

    assert.equal(result.sampleRate, 16000);
    assert.equal(result.samples.length, 3);
    assert.equal(result.samples[0], 0);
    assert.ok(Math.abs(result.samples[1] - 0.5) < 0.00001);
    assert.ok(Math.abs(result.samples[2] + 0.5) < 0.00001);
});
