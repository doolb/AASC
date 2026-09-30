'use strict';

const { randomUUID } = require('node:crypto');
const { DEFAULT_MAX_MIB, BYTES_PER_MIB, normalizeAudioCacheMaxMiB } = require('./tts-audio-cache-config');

// 音频引用供原有 basename/URL 下发流程使用，并不对应磁盘文件。
let maxMiB = DEFAULT_MAX_MIB;
const limits = Object.freeze({ ttlMs: 10 * 60 * 1000,
    get maxBytes() { return maxMiB * BYTES_PER_MIB; },
    get maxMiB() { return maxMiB; },
    maxAudioBytes: 16 * 1024 * 1024, maxEntries: 1024 });
const entries = new Map();
let totalBytes = 0;

function configure(value) {
    // 降低上限也保留已下发引用，仅限制后续入缓存，等待旧音频自然过期。
    maxMiB = normalizeAudioCacheMaxMiB(value);
    cleanup();
    return maxMiB;
}

function cleanup(now = Date.now()) {
    for (const [name, entry] of entries) {
        if (entry.expiresAt > now) continue;
        entries.delete(name);
        totalBytes -= entry.buffer.length;
    }
}

function isMemoryAudioName(name) {
    return /^tts_mem_[0-9a-f-]{36}\.wav$/.test(name);
}

function storeAudio(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12
        || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('TTS 返回了无效的 WAV 音频');
    }
    if (buffer.length > limits.maxAudioBytes) throw new Error('TTS 单段音频超过 16MiB 上限');
    const now = Date.now();
    cleanup(now);
    // 不驱逐仍有效的引用：它可能已经下发，但还在某个显示端队列里。
    if (totalBytes + buffer.length > limits.maxBytes || entries.size >= limits.maxEntries) {
        const error = new Error('TTS 音频缓存已满，请稍后重试');
        error.code = 'TTS_AUDIO_CACHE_FULL';
        throw error;
    }
    const name = `tts_mem_${randomUUID()}.wav`;
    entries.set(name, Object.freeze({ name, buffer, expiresAt: now + limits.ttlMs }));
    totalBytes += buffer.length;
    return name;
}

function storeBase64Audio(audioData) {
    // 先检查编码长度再解码，避免异常回包制造无上限的额外 Buffer。
    if (typeof audioData !== 'string' || !audioData.length
        || audioData.length > Math.ceil(limits.maxAudioBytes / 3) * 4) {
        throw new Error('显示端 TTS 音频为空或超过 16MiB 上限');
    }
    if (audioData.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioData)) {
        throw new Error('显示端 TTS 音频编码无效');
    }
    return storeAudio(Buffer.from(audioData, 'base64'));
}

function getAudio(name) {
    cleanup();
    return entries.get(name) || null;
}

function getStats() {
    cleanup();
    return { count: entries.size, totalBytes, ...limits };
}

module.exports = { limits, configure, storeAudio, storeBase64Audio, getAudio, getStats, cleanup, isMemoryAudioName };
