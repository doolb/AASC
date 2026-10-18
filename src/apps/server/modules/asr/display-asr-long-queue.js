'use strict';

const DEFAULT_CONFIG = Object.freeze({ thresholdSeconds: 10, concurrency: 1 });
const MAX_WAITING_PER_DISPLAY = 8;

function normalizeConfig(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const choose = (key, minimum, maximum) => Number.isInteger(source[key])
        && source[key] >= minimum && source[key] <= maximum ? source[key] : DEFAULT_CONFIG[key];
    return { thresholdSeconds: choose('thresholdSeconds', 1, 120), concurrency: choose('concurrency', 1, 8) };
}

function validateConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Number.isInteger(value.thresholdSeconds) || value.thresholdSeconds < 1 || value.thresholdSeconds > 120
        || !Number.isInteger(value.concurrency) || value.concurrency < 1 || value.concurrency > 8) {
        throw new Error('长语音阈值须为 1–120 秒，并发上限须为 1–8 条整数');
    }
    return { thresholdSeconds: value.thresholdSeconds, concurrency: value.concurrency };
}

// WAV 按实际 PCM 数据长度计算时长；仅识别无压缩 PCM/浮点格式，异常头不参与分流。
function wavDurationMs(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 44
        || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
    let byteRate = 0;
    let dataBytes = 0;
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        const name = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        const start = offset + 8;
        if (size > buffer.length - start) return null;
        if (name === 'fmt ' && size >= 16) {
            const format = buffer.readUInt16LE(start);
            const channels = buffer.readUInt16LE(start + 2);
            const sampleRate = buffer.readUInt32LE(start + 4);
            const declaredByteRate = buffer.readUInt32LE(start + 8);
            const bitsPerSample = buffer.readUInt16LE(start + 14);
            if (![1, 3].includes(format) || channels < 1 || sampleRate < 1
                || bitsPerSample < 8 || bitsPerSample % 8 !== 0
                || declaredByteRate !== sampleRate * channels * bitsPerSample / 8) return null;
            byteRate = declaredByteRate;
        }
        if (name === 'data') dataBytes += size;
        offset = start + size + (size % 2);
    }
    return byteRate > 0 && dataBytes > 0 ? dataBytes * 1000 / byteRate : null;
}

function audioDurationMs(buffer, context = {}) {
    const wavMs = wavDurationMs(buffer);
    if (wavMs !== null) return wavMs;
    if (context.speechStartAt == null || context.speechEndAt == null) return null;
    const start = Number(context.speechStartAt);
    const end = Number(context.speechEndAt);
    return Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= 3600000
        ? end - start : null;
}

function queueError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function createDisplayAsrLongQueue(initialConfig = DEFAULT_CONFIG) {
    let config = normalizeConfig(initialConfig);
    const states = new Map();

    function cleanup(targetId, state) {
        if (state.active === 0 && state.waiting.length === 0) states.delete(targetId);
    }

    function drain(targetId, state) {
        while (state.active < config.concurrency && state.waiting.length) {
            const entry = state.waiting.shift();
            entry.signal?.removeEventListener('abort', entry.abort);
            if (entry.signal?.aborted) {
                entry.reject(queueError('asr_queue_cancelled', 'ASR 请求已取消'));
                continue;
            }
            state.active += 1;
            // 等待中的 HTTP 请求不启动显示端计时；仅获得准入后才执行转发任务。
            Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(() => {
                state.active -= 1;
                drain(targetId, state);
                cleanup(targetId, state);
            });
        }
        cleanup(targetId, state);
    }

    function enqueue(targetId, task, signal) {
        if (signal?.aborted) return Promise.reject(queueError('asr_queue_cancelled', 'ASR 请求已取消'));
        let state = states.get(targetId);
        if (!state) {
            state = { active: 0, waiting: [] };
            states.set(targetId, state);
        }
        if (state.active >= config.concurrency && state.waiting.length >= MAX_WAITING_PER_DISPLAY) {
            return Promise.reject(queueError('asr_queue_full', '显示端长语音 ASR 队列已满'));
        }
        return new Promise((resolve, reject) => {
            const entry = { task, resolve, reject, signal, abort: null };
            entry.abort = () => {
                const index = state.waiting.indexOf(entry);
                if (index < 0) return;
                state.waiting.splice(index, 1);
                signal?.removeEventListener('abort', entry.abort);
                reject(queueError('asr_queue_cancelled', 'ASR 请求已取消'));
                cleanup(targetId, state);
            };
            signal?.addEventListener('abort', entry.abort, { once: true });
            state.waiting.push(entry);
            drain(targetId, state);
        });
    }

    return Object.freeze({
        enqueue,
        setConfig(value) {
            config = validateConfig(value);
            for (const [targetId, state] of states) drain(targetId, state);
        },
        getConfig: () => ({ ...config })
    });
}

function createDisplayAsrLongQueueSettings({ config, queue, broadcast }) {
    const snapshot = extra => ({ type: 'asrLongQueueConfig',
        ...normalizeConfig(config.get('asr.displayLongQueue')), ...extra });
    function handle(socket, data) {
        if (data.type === 'getAsrLongQueueConfig') {
            socket.send(JSON.stringify(snapshot({ requestId: data.requestId })));
            return true;
        }
        if (data.type !== 'setAsrLongQueueConfig') return false;
        try {
            const normalized = validateConfig(data);
            // 写盘失败时 config.set 回滚旧值，不得让运行时队列先应用未保存的新值。
            if (!config.set('asr.displayLongQueue', normalized)) throw new Error('保存 ASR 长语音配置失败');
            queue.setConfig(normalized);
            broadcast(snapshot({ requestId: data.requestId, success: true }));
        } catch (error) {
            socket.send(JSON.stringify(snapshot({ requestId: data.requestId, success: false, message: error.message })));
        }
        return true;
    }
    return Object.freeze({ snapshot, handle });
}

module.exports = { DEFAULT_CONFIG, MAX_WAITING_PER_DISPLAY, normalizeConfig, validateConfig,
    wavDurationMs, audioDurationMs, createDisplayAsrLongQueue, createDisplayAsrLongQueueSettings };
