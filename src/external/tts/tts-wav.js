'use strict';

const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

function validateWav(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.length > MAX_AUDIO_BYTES
        || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE'
        || buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('TTS 返回了无效或截断的 WAV');
    let format = null;
    let samples = null;
    for (let offset = 12; offset + 8 <= buffer.length;) {
        const size = buffer.readUInt32LE(offset + 4);
        if (offset + 8 + size > buffer.length) throw new Error('TTS WAV 块不完整');
        const name = buffer.toString('ascii', offset, offset + 4);
        if (name === 'fmt ' && size >= 16) format = buffer.subarray(offset + 8, offset + 24);
        if (name === 'data') samples = buffer.subarray(offset + 8, offset + 8 + size);
        offset += 8 + size + (size % 2);
    }
    if (!format || !samples?.length || ![1, 3].includes(format.readUInt16LE(0))
        || !format.readUInt16LE(2) || !format.readUInt32LE(4) || !format.readUInt16LE(12)
        || samples.length % format.readUInt16LE(12) !== 0) throw new Error('TTS WAV 音频格式不完整');
    return { format, samples };
}

function wrapPcm(pcm, sampleRate = 24000) {
    if (!Buffer.isBuffer(pcm) || pcm.length === 0 || pcm.length % 2 !== 0 || pcm.length + 44 > MAX_AUDIO_BYTES) throw new Error('TTS PCM 音频为空、截断或超过上限');
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

// 百炼完整下载的WAV仍可能保留流式占位头；仅兼容实际验证过的44字节PCM头形状。
// 普通长度错误不修改，继续交给严格校验拒绝；不能把任意截断文件当完整PCM补齐。
function normalizeQwenWav(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.length > MAX_AUDIO_BYTES) return buffer;
    const knownPlaceholder = buffer.toString('ascii', 0, 4) === 'RIFF'
        && buffer.toString('ascii', 8, 16) === 'WAVEfmt '
        && buffer.readUInt32LE(4) === 0x7fffffbf && buffer.readUInt32LE(16) === 16
        && buffer.toString('ascii', 36, 40) === 'data' && buffer.readUInt32LE(40) === 0x7fffff9b;
    if (!knownPlaceholder) return buffer;
    const sampleRate = buffer.readUInt32LE(24);
    if (buffer.readUInt16LE(20) !== 1 || buffer.readUInt16LE(22) !== 1
        || buffer.readUInt16LE(32) !== 2 || buffer.readUInt16LE(34) !== 16
        || !sampleRate || sampleRate > 192000 || buffer.readUInt32LE(28) !== sampleRate * 2) {
        throw new Error('Qwen TTS WAV 占位头的PCM格式无效');
    }
    return wrapPcm(buffer.subarray(44), sampleRate);
}

// Qwen 非实时接口不提供速率/音量字段，使用本地PCM变换统一参数语义，不写盘。
function adjustWav(buffer, speed = 0, volume = 100) {
    if (speed === 0 && volume === 100) return buffer;
    if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('TTS 返回了无效 WAV');
    let format = null;
    let samples = null;
    for (let offset = 12; offset + 8 <= buffer.length;) {
        const size = buffer.readUInt32LE(offset + 4);
        if (offset + 8 + size > buffer.length) throw new Error('TTS WAV 块不完整');
        const name = buffer.toString('ascii', offset, offset + 4);
        if (name === 'fmt ' && size >= 16) format = buffer.subarray(offset + 8, offset + 24);
        if (name === 'data') samples = buffer.subarray(offset + 8, offset + 8 + size);
        offset += 8 + size + (size % 2);
    }
    if (!format || !samples || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 || format.readUInt16LE(14) !== 16) throw new Error('速率/音量调整需要单声道16位PCM WAV');
    const ratio = Math.pow(2, speed / 10);
    const length = Math.floor(samples.length / 2 / ratio);
    if (length < 1 || length * 2 + 44 > MAX_AUDIO_BYTES) throw new Error('调整后的TTS音频为空或超过上限');
    const result = Buffer.alloc(length * 2);
    for (let i = 0; i < length; i++) {
        const source = Math.min(samples.length / 2 - 1, Math.floor(i * ratio));
        result.writeInt16LE(Math.round(samples.readInt16LE(source * 2) * volume / 100), i * 2);
    }
    return wrapPcm(result, format.readUInt32LE(4));
}


// 两个上游适配器共用限长base64校验，不让Chat2API依赖TTS业务模块。
function decodeAudio(value) {
    if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4
        || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw new Error('TTS 音频编码无效或超过上限');
    return Buffer.from(value, 'base64');
}

module.exports = { MAX_AUDIO_BYTES, decodeAudio, wrapPcm, normalizeQwenWav, adjustWav, validateWav };
