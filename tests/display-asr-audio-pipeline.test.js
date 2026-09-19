'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const PCM_CAPTURE = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/pcm-audio-capture.js');

test('录音显示端使用原始 PCM 公共 ASR，APK 提供端保留原生入口', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');
    const pcmCapture = fs.readFileSync(PCM_CAPTURE, 'utf8');

    assert.match(display, /js\/pcm-audio-capture\.js/);
    assert.match(display, /function startRawPcmCapture\(/);
    assert.match(display, /new PcmAudioCapture\(\{ segmentMode: true, preRollMs: 300 \}\)/);
    assert.match(display, /pcmCapture\.beginSegment\(\)/);
    assert.match(pcmCapture, /class PcmAudioCapture/);
    assert.match(pcmCapture, /createScriptProcessor\(/);
    assert.match(pcmCapture, /encodeWav\(/);
    assert.match(display, /sampleRate: 16000/);
    assert.match(display, /fetch\('\/api\/asr\/recognize'/);
    assert.match(display, /nativeAsrAvailable/);
    assert.match(display, /handleAsrAudio/);
    assert.doesNotMatch(display, /new MediaRecorder\(/);
});

test('浏览器显示端 ASR 使用持久化 displayId 绑定来源且不依赖请求头', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');
    const connectStart = display.indexOf('function connectWebSocket()');
    const connectEnd = display.indexOf('socket.onopen = function()', connectStart);
    const connectBlock = display.slice(connectStart, connectEnd);
    const recognitionStart = display.indexOf('async function sendAudioForRecognition');
    const recognitionEnd = display.indexOf('// 只有服务器选中的 APK 提供端', recognitionStart);
    const recognitionBlock = display.slice(recognitionStart, recognitionEnd);

    assert.match(display, /let displayId = '';/, '显示端应显式保存运行时来源 ID');
    assert.match(
        connectBlock,
        /const id = getPersistentDisplayId\(\);[\s\S]*displayId = id;/,
        'WebSocket 连接初始化应立即复用持久化 ID'
    );
    assert.match(
        recognitionBlock,
        /const requestDisplayId = typeof displayId === 'string'[\s\S]*\? displayId\.trim\(\)[\s\S]*: getPersistentDisplayId\(\);/,
        'ASR 上传应在运行时 ID 缺失时回退到持久化 ID'
    );
    assert.match(
        recognitionBlock,
        /formData\.append\(['"]displayId['"], requestDisplayId\)/,
        'ASR 上传应通过 multipart displayId 字段传递来源'
    );
    assert.doesNotMatch(recognitionBlock, /X-AASC-Display-Id/i, '浏览器显示端不应依赖来源请求头');
});

test('APK 录音不主动启用浏览器回声消除和噪声抑制', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');
    const recordingBlock = display.match(/micStream = await navigator\.mediaDevices\.getUserMedia\(\{([\s\S]*?)\}\);/);

    assert.ok(recordingBlock);
    assert.match(recordingBlock[1], /echoCancellation:\s*false/);
    assert.match(recordingBlock[1], /noiseSuppression:\s*false/);
});

test('正式显示端所有录音上传统一为 WAV', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');

    assert.doesNotMatch(display, /new MediaRecorder\(/);
    assert.doesNotMatch(display, /audio\/webm/);
    assert.match(display, /function startRawPcmCapture\(/);
    assert.match(display, /recording\.wav/);
});

test('显示端分段 PCM 采集在 VAD 触发前丢弃长静音并保留短前置缓冲', async () => {
    const source = fs.readFileSync(PCM_CAPTURE, 'utf8');
    let processor = null;

    class FakeAudioNode {
        connect() {
            return this;
        }

        disconnect() {}
    }

    class FakeAudioContext extends FakeAudioNode {
        constructor() {
            super();
            this.sampleRate = 16000;
        }

        createMediaStreamSource() {
            return new FakeAudioNode();
        }

        createScriptProcessor() {
            processor = new FakeAudioNode();
            return processor;
        }

        createGain() {
            const gain = new FakeAudioNode();
            gain.gain = { value: 0 };
            return gain;
        }

        close() {
            return Promise.resolve();
        }
    }

    const sandbox = { window: { AudioContext: FakeAudioContext }, Blob };
    vm.runInNewContext(source, sandbox);
    const segmentCapture = new sandbox.window.PcmAudioCapture({
        bufferSize: 1600,
        segmentMode: true,
        preRollMs: 100
    }).start({});

    assert.equal(segmentCapture.takeWav(), null, 'VAD 尚未触发时不应生成语音 WAV');

    const emit = (samples) => {
        processor.onaudioprocess({
            inputBuffer: {
                getChannelData: () => new Float32Array(samples)
            }
        });
    };
    emit(new Array(1600).fill(0));
    emit(new Array(1600).fill(0));
    emit(new Array(1600).fill(0));
    assert.equal(segmentCapture.beginSegment(), true, 'VAD 触发后应开始缓存语音段');
    emit(new Array(1600).fill(0.5));
    emit(new Array(1600).fill(0));

    const wav = segmentCapture.takeWav();
    assert.ok(wav, '语音段应能生成 WAV');
    const bytes = new Uint8Array(await wav.arrayBuffer());
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint32(40, true) / 2, 4800, 'WAV 只应包含 100ms 前置缓冲、语音和尾部静音');
    assert.equal(view.getInt16(44 + 1600 * 2, true), 16383, '前置缓冲后应紧接检测到的语音');
    segmentCapture.stop();
});

test('PCM 采集暂停时清空旧语音段，恢复后复用原有音频链路', async () => {
    const source = fs.readFileSync(PCM_CAPTURE, 'utf8');
    let processor = null;

    class FakeAudioNode {
        connect() {
            return this;
        }

        disconnect() {}
    }

    class FakeAudioContext extends FakeAudioNode {
        constructor() {
            super();
            this.sampleRate = 16000;
        }

        createMediaStreamSource() {
            return new FakeAudioNode();
        }

        createScriptProcessor() {
            processor = new FakeAudioNode();
            return processor;
        }

        createGain() {
            const gain = new FakeAudioNode();
            gain.gain = { value: 0 };
            return gain;
        }

        close() {
            return Promise.resolve();
        }
    }

    const sandbox = { window: { AudioContext: FakeAudioContext }, Blob };
    vm.runInNewContext(source, sandbox);
    const capture = new sandbox.window.PcmAudioCapture({
        bufferSize: 1600,
        segmentMode: true,
        preRollMs: 100
    }).start({});
    const emit = (samples) => {
        processor.onaudioprocess({
            inputBuffer: {
                getChannelData: () => new Float32Array(samples)
            }
        });
    };

    assert.equal(capture.beginSegment(), true, '应能开始缓存 TTS 前的语音段');
    emit(new Array(1600).fill(0.5));
    capture.setPaused(true);
    assert.equal(capture.takeWav(), null, '暂停时必须丢弃 TTS 前未完成的语音段');

    capture.setPaused(false);
    assert.equal(capture.beginSegment(), true, '恢复后应能重新开始语音段');
    emit(new Array(1600).fill(0.25));
    const wav = capture.takeWav();
    assert.ok(wav, '恢复后应继续使用原采集器生成 WAV');
    capture.stop();
});

test('PCM 采集器支持实时回调并可选择不缓存完整录音', () => {
    const source = fs.readFileSync(PCM_CAPTURE, 'utf8');
    let processor = null;
    const receivedChunks = [];

    class FakeAudioNode {
        connect() {
            return this;
        }

        disconnect() {}
    }

    class FakeAudioContext extends FakeAudioNode {
        constructor() {
            super();
            this.sampleRate = 48000;
        }

        createMediaStreamSource() {
            return new FakeAudioNode();
        }

        createScriptProcessor() {
            processor = new FakeAudioNode();
            return processor;
        }

        createGain() {
            const gain = new FakeAudioNode();
            gain.gain = { value: 0 };
            return gain;
        }

        close() {
            return Promise.resolve();
        }
    }

    const sandbox = { window: { AudioContext: FakeAudioContext } };
    vm.runInNewContext(source, sandbox);
    const capture = new sandbox.window.PcmAudioCapture({
        bufferSize: 480,
        streamOnly: true,
        onChunk: (samples, sourceSampleRate) => receivedChunks.push({ samples, sourceSampleRate })
    }).start({});

    processor.onaudioprocess({
        inputBuffer: {
            getChannelData: () => new Float32Array([0.5, -0.5, 0.25])
        }
    });

    assert.equal(receivedChunks.length, 1, '实时模式应回调每个 PCM 音频块');
    assert.equal(receivedChunks[0].sourceSampleRate, 48000);
    assert.deepEqual(Array.from(receivedChunks[0].samples), [0.5, -0.5, 0.25]);
    assert.equal(capture.takeWav(), null, '实时模式不应缓存完整录音');
    assert.ok(sandbox.window.PcmAudioCapture.encodePcm16, '应提供 PCM16 编码方法');
    capture.stop();
});
