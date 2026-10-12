'use strict';

const { isMainThread, parentPort } = require('node:worker_threads');
const { validateOggOpus, createOpusDecodePages } = require('./tts-ogg');
const { MAX_AUDIO_BYTES, wrapPcm, validateWav } = require('./tts-wav');

const invalid = () => { throw Object.assign(new Error('TTS Opus音频解码失败或不完整'), { code: 'TTS_OPUS_INVALID' }); };
const overLimit = () => { throw Object.assign(new Error('TTS Opus解码音频超过安全上限'), { code: 'TTS_OPUS_LIMIT' }); };

// 库可能在发生错误后继续输出PCM；严格验证每次结果，不接受带错误的部分音频。
function checkDecoded(result, expectedRate = null) {
    if (!result || !Array.isArray(result.errors) || result.errors.length || !Array.isArray(result.channelData)
        || !Number.isSafeInteger(result.samplesDecoded) || result.samplesDecoded < 0
        || ![8000, 12000, 16000, 24000, 48000].includes(result.sampleRate)
        || (expectedRate !== null && result.sampleRate !== expectedRate)) invalid();
    // Ogg解析器在收齐下一页之前不产出音频，合法头部/缓冲结果为零声道零样本。
    if (result.samplesDecoded === 0 && result.channelData.length === 0) return new Float32Array(0);
    if (result.channelData.length !== 1 || !(result.channelData[0] instanceof Float32Array)
        || result.channelData[0].length !== result.samplesDecoded) invalid();
    if (result.channelData[0].byteLength > 32 * 1024 * 1024) overLimit();
    if (!result.channelData[0].every(Number.isFinite)) invalid();
    return result.channelData[0];
}

async function decodeAudio(bytes) {
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const metadata = validateOggOpus(input, { collectPackets: true });
    const { OggOpusDecoder } = await import('ogg-opus-decoder');
    const decoder = new OggOpusDecoder({ forceStereo: false, speechQualityEnhancement: 'none' });
    const chunks = [];
    let count = 0, rate = null;
    const consume = result => {
        const pcm = checkDecoded(result, rate);
        // 空头部也核对rate；真实音频声道由Ogg校验与checkDecoded分别保证。
        rate = result.sampleRate;
        count += pcm.length;
        if (count * 4 > 32 * 1024 * 1024 || count * 2 + 44 > MAX_AUDIO_BYTES) overLimit();
        if (pcm.length) chunks.push(pcm);
    };
    try {
        await decoder.ready;
        // 一包一页避开codec-parser的跨页Tags/continued缺陷，同时不构造整段重排容器副本。
        for (const page of createOpusDecodePages(metadata)) consume(await decoder.decode(page));
        consume(await decoder.flush());
        if (!count || count !== metadata.sampleCount48k * rate / 48000) invalid();
        const pcm = Buffer.alloc(count * 2);
        // OpusHead gain为signed Q8 dB。规范化头部gain归0，实际增益在此恰好应用一次。
        const gain = Math.pow(10, metadata.outputGain / (20 * 256));
        let position = 0;
        for (const chunk of chunks) for (const sample of chunk) {
            const clipped = Math.max(-1, Math.min(1, sample * gain));
            pcm.writeInt16LE(Math.round(clipped * (clipped < 0 ? 32768 : 32767)), position); position += 2;
        }
        const audio = wrapPcm(pcm, rate); validateWav(audio);
        return audio;
    } finally { decoder.free(); }
}

// 主线程导入仅供纯PCM边界测试；真实解码始终由父模块启动的worker执行。
if (!isMainThread) parentPort.once('message', async ({ audio }) => {
    try {
        const result = await decodeAudio(audio);
        // transfer只发送独占WAV副本，不跨线程传输解码错误原文或日志。
        const output = new Uint8Array(result.length); output.set(result);
        parentPort.postMessage({ audio: output }, [output.buffer]);
    } catch (error) {
        parentPort.postMessage({ code: error.code === 'TTS_OPUS_LIMIT' ? 'TTS_OPUS_LIMIT' : 'TTS_OPUS_INVALID' });
    }
});

module.exports = { checkDecoded };
