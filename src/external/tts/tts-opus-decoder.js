'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { validateOggOpus } = require('./tts-ogg');
const { validateWav } = require('./tts-wav');

const ERROR_MESSAGES = Object.freeze({ TTS_OPUS_INVALID: 'TTS Opus音频解码失败或不完整',
    TTS_OPUS_LIMIT: 'TTS Opus解码音频超过安全上限', TTS_OPUS_CANCELLED: 'TTS Opus音频解码已取消',
    TTS_OPUS_TIMEOUT: 'TTS Opus音频解码超时', TTS_OPUS_CAPACITY: 'TTS Opus解码繁忙，请稍后重试' });
const opusError = code => Object.assign(new Error(ERROR_MESSAGES[code] || ERROR_MESSAGES.TTS_OPUS_INVALID),
    { code: Object.hasOwn(ERROR_MESSAGES, code) ? code : 'TTS_OPUS_INVALID' });

/** 最多两个Worker；工厂默认无等待，正式共享池启用有界等待以承接多路上游音频。 */
function createOpusWavDecoder({ createWorker = () => new Worker(path.join(__dirname, 'tts-opus-decode-worker.js')),
    maxWaiting = 0, maxWaitingBytes = 64 * 1024 * 1024 } = {}) {
    if (!Number.isInteger(maxWaiting) || maxWaiting < 0 || maxWaiting > 256
        || !Number.isSafeInteger(maxWaitingBytes) || maxWaitingBytes < 0 || maxWaitingBytes > 64 * 1024 * 1024) {
        throw new Error('Opus解码等待容量无效');
    }
    let active = 0;
    let waitingBytes = 0;
    const waiting = [];
    const invalid = ({ signal, deadline }) => signal?.aborted ? opusError('TTS_OPUS_CANCELLED')
        : Date.now() >= deadline ? opusError('TTS_OPUS_TIMEOUT') : null;
    // 对应.src/framework/tts-provider-configuration.md：等待本地Worker不占用上游连接槽位。
    const drain = () => {
        while (waiting.length) {
            const item = waiting[0];
            const error = invalid(item);
            if (error) { item.finish(error); continue; }
            if (active >= 2) break;
            item.finish();
        }
    };
    const start = (input, metadata, { signal, deadline }) => {
        const error = invalid({ signal, deadline });
        if (error) return Promise.reject(error);
        let worker;
        try { worker = createWorker(); } catch { return Promise.reject(opusError('TTS_OPUS_INVALID')); }
        active++;
        const timeoutMs = Math.min(60000, deadline - Date.now());
        return new Promise((resolve, reject) => {
            let settled = false;
            let timer;
            const finish = async (error, audio) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer); signal?.removeEventListener('abort', abort);
                worker.removeListener('message', message); worker.removeListener('error', failed);
                worker.removeListener('exit', exited);
                // 终止中仍可能收到error事件；仅消费到terminate完成，不能形成未处理异常。
                const ignoreError = () => {}; worker.on('error', ignoreError);
                try { await worker.terminate(); }
                catch { error = error || opusError('TTS_OPUS_INVALID'); }
                finally { worker.removeListener('error', ignoreError); active--; drain(); }
                // 终止worker本身也是异步阶段；调用方在结果真正交付前取消仍不能缓存/播放迟到WAV。
                if (!error && signal?.aborted) error = opusError('TTS_OPUS_CANCELLED');
                if (!error && Date.now() >= deadline) error = opusError('TTS_OPUS_TIMEOUT');
                if (error) reject(error); else resolve(audio);
            };
            const abort = () => { void finish(opusError('TTS_OPUS_CANCELLED')); };
            const failed = () => { void finish(opusError('TTS_OPUS_INVALID')); };
            const exited = () => { if (!settled) failed(); };
            const message = data => {
                if (settled) return;
                if (signal?.aborted) return abort();
                if (Date.now() >= deadline) return void finish(opusError('TTS_OPUS_TIMEOUT'));
                try {
                    if (data?.code) return void finish(opusError(data.code));
                    if (!(data?.audio instanceof Uint8Array)) throw opusError('TTS_OPUS_INVALID');
                    const audio = Buffer.from(data.audio.buffer, data.audio.byteOffset, data.audio.byteLength);
                    const { format, samples } = validateWav(audio);
                    const rate = format.readUInt32LE(4);
                    if (format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 || format.readUInt16LE(14) !== 16
                        || ![8000, 12000, 16000, 24000, 48000].includes(rate)
                        || samples.length / 2 !== metadata.sampleCount48k * rate / 48000) throw opusError('TTS_OPUS_INVALID');
                    void finish(null, audio);
                } catch { failed(); }
            };
            worker.on('message', message); worker.on('error', failed); worker.on('exit', exited);
            signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => { void finish(opusError('TTS_OPUS_TIMEOUT')); }, timeoutMs);
            if (signal?.aborted) return abort();
            try { worker.postMessage({ audio: input }, [input.buffer]); } catch { failed(); }
        });
    };
    return async function decode(buffer, { signal, deadline = Date.now() + 60000 } = {}) {
        if (signal?.aborted) throw opusError('TTS_OPUS_CANCELLED');
        if (!Number.isFinite(deadline) || deadline <= Date.now()) throw opusError('TTS_OPUS_TIMEOUT');
        if (active >= 2 && waiting.length >= maxWaiting) throw opusError('TTS_OPUS_CAPACITY');
        const metadata = validateOggOpus(buffer);
        if (signal?.aborted) throw opusError('TTS_OPUS_CANCELLED');
        if (deadline <= Date.now()) throw opusError('TTS_OPUS_TIMEOUT');
        if (active >= 2 && waitingBytes + buffer.length > maxWaitingBytes) throw opusError('TTS_OPUS_CAPACITY');
        // 保留独占输入副本，排队时调用方改变/释放原Buffer也不会破坏解码元数据。
        const input = new Uint8Array(buffer.length); input.set(buffer);
        if (active < 2) return start(input, metadata, { signal, deadline });
        return new Promise((resolve, reject) => {
            let settled = false, timer;
            const abort = () => item.finish(opusError('TTS_OPUS_CANCELLED'));
            const item = { signal, deadline, finish(error) {
                if (settled) return;
                settled = true;
                clearTimeout(timer); signal?.removeEventListener('abort', abort);
                waiting.splice(waiting.indexOf(item), 1); waitingBytes -= input.byteLength;
                if (error) reject(error);
                else resolve(start(input, metadata, { signal, deadline }));
            } };
            waiting.push(item); waitingBytes += input.byteLength;
            signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => item.finish(opusError('TTS_OPUS_TIMEOUT')), Math.min(60000, deadline - Date.now()));
            if (signal?.aborted) abort();
        });
    };
}

const decodeOggOpusToWav = createOpusWavDecoder({ maxWaiting: 256 });
module.exports = { decodeOggOpusToWav, createOpusWavDecoder, opusError };
