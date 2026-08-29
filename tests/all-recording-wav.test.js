'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('控制端语音输入使用共享 PCM/WAV 采集器', () => {
    const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
    const chat = read('src/apps/web-mediacenter/ui/public/js/chat.js');

    assert.match(upload, /js\/pcm-audio-capture\.js/);
    assert.match(chat, /PcmAudioCapture/);
    assert.doesNotMatch(chat, /MediaRecorder/);
    assert.doesNotMatch(chat, /audio\/webm/);
    assert.match(chat, /recording\.wav/);
});

test('控制端声纹注册使用共享 PCM/WAV 采集器', () => {
    const panel = read('src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js');

    assert.match(panel, /PcmAudioCapture/);
    assert.doesNotMatch(panel, /MediaRecorder/);
    assert.doesNotMatch(panel, /audio\/webm/);
    assert.match(panel, /voiceprint\.wav/);
});

test('子显示端 ASR 上传契约使用 WAV', () => {
    const nodeClient = read('src/apps/voice-display-node/asr-client.js');
    const goClient = read('3rd/voice-display/asr.go');
    const csClient = read('3rd/voice-display-cs/AsrClient.cs');
    const nodeRecorder = read('src/apps/voice-display-node/audio-recorder-pv.js');

    assert.match(nodeClient, /filename:\s*'audio\.wav'/);
    assert.match(goClient, /CreateFormFile\("audio",\s*"audio\.wav"\)/);
    assert.match(csClient, /"audio\/wav"/);
    assert.match(nodeRecorder, /encodeWAV\(/);
});

test('独立 ttslive 网页录音不再把 WebM 伪装成 WAV', () => {
    const app = read('3rd/ttslive/static/app.js');
    const index = read('3rd/ttslive/static/index.html');

    assert.match(index, /\/static\/pcm-audio-capture\.js/);
    assert.match(app, /PcmAudioCapture/);
    assert.doesNotMatch(app, /MediaRecorder/);
    assert.doesNotMatch(app, /audio\/webm/);
    assert.match(app, /recording\.wav/);
});

test('共享 PCM 采集器输出 16kHz 单声道 16-bit WAV', async () => {
    const source = read('src/apps/web-mediacenter/ui/public/js/pcm-audio-capture.js');
    const sandbox = { window: {}, Blob };
    vm.runInNewContext(source, sandbox);
    const wav = sandbox.window.PcmAudioCapture.encodeWav(
        new Float32Array([0, 0.5, -0.5, 1]),
        48000,
        16000
    );
    const bytes = new Uint8Array(await wav.arrayBuffer());
    const view = new DataView(bytes.buffer);

    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF');
    assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE');
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), 16000);
    assert.equal(view.getUint16(34, true), 16);
});
