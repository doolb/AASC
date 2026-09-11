'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const server = read('src/apps/server/boot/server-app.js');
const asrService = read('src/external/asr/asr-service.js');
const asrWorker = read('src/external/asr/asr-worker-process.js');
const nodeClient = read('src/apps/voice-display-node/asr-client.js');
const nodeMain = read('src/apps/voice-display-node/main.js');
const nodeRecorder = read('src/apps/voice-display-node/audio-recorder.js');
const nodeRecorderPv = read('src/apps/voice-display-node/audio-recorder-pv.js');
const webDisplay = read('src/apps/web-mediacenter/ui/public/display.html');

const getAsrRoute = () => {
    const start = server.indexOf("app.post('/api/asr/recognize'");
    const end = server.indexOf("app.get('/api/config'", start);
    assert.notEqual(start, -1, '应找到 ASR HTTP 接口');
    assert.notEqual(end, -1, '应找到 ASR HTTP 接口结束位置');
    return server.slice(start, end);
};

const asrRoute = getAsrRoute();

assert.match(server, /ASR_MAX_AUDIO_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/, '服务端应限制内存上传大小');
assert.match(server, /multer\.memoryStorage\(\)/, 'ASR 上传应使用内存存储');
assert.match(server, /parseAsrUpload/, 'ASR 上传应统一处理 multer 错误');
assert.match(asrRoute, /req\.file\.buffer/, 'ASR 接口应直接使用内存 Buffer');
assert.doesNotMatch(asrRoute, /req\.file\.path|cleanupTempFile/, 'ASR 请求不应创建或清理临时文件');
assert.match(asrRoute, /processedByServer/, 'ASR 接口应返回服务端已处理标记');

assert.match(server, /DEFAULT_VAD_SILENCE_DURATION_MS\s*=\s*500/, '服务端应统一 500ms 静音结束时长');
assert.match(server, /DEFAULT_VAD_MIN_SPEECH_DURATION_MS\s*=\s*300/, '服务端应统一最短语音时长');
assert.match(server, /voiceVadConfig[\s\S]*silenceDurationMs[\s\S]*minSpeechDurationMs/, '服务端下发 VAD 时应包含完整配置');

assert.match(asrService, /Buffer\.isBuffer\(audioInput\)/, 'ASR 服务应支持直接接收 Buffer');
assert.match(asrService, /convertAudioBuffer/, '非 WAV 内存音频应通过管道转换');
assert.match(asrService, /pipe:0[\s\S]*pipe:1/, '音频格式转换应使用 ffmpeg 标准输入输出管道');
assert.match(asrWorker, /audioBuffer/, '隔离 ASR 子进程应支持传递音频 Buffer');
assert.match(asrService, /serialization:\s*'advanced'/, '隔离 ASR IPC 应使用支持 Buffer 的序列化方式');

assert.match(nodeClient, /displayId/, 'Node 显示端 ASR 请求应携带显示端 ID');
assert.match(nodeClient, /speechStartAt|speechEndAt/, 'Node 显示端 ASR 请求应携带语音时间信息');
assert.match(nodeMain, /voiceVadConfig/, 'Node 显示端应处理服务端 VAD 配置');
assert.match(nodeMain, /processedByServer/, 'Node 显示端应避免服务端已处理后的旧 WS 重复上报');
assert.match(nodeMain, /pauseRecordingDuringPlayback/, 'Node 显示端应复用服务端全局播放暂停录音配置');
assert.match(nodeMain, /case 'voiceprintConfig'/, 'Node 显示端应处理服务端声纹/播放录音配置');
assert.match(nodeMain, /vadSilenceDurationMs/, 'Node 显示端录音器应使用静音结束时长');
assert.match(nodeMain, /vadMinSpeechDurationMs/, 'Node 显示端录音器应使用最短语音时长');
assert.match(nodeRecorder, /setVadConfig/, 'naudiodon 录音器应支持运行时更新 VAD 配置');
assert.match(nodeRecorderPv, /setVadConfig/, 'PvRecorder 录音器应支持运行时更新 VAD 配置');

assert.match(webDisplay, /vadSilenceDurationMs/, '网页显示端应使用可下发的静音结束时长');
assert.match(webDisplay, /vadMinSpeechDurationMs/, '网页显示端应使用可下发的最短语音时长');
assert.doesNotMatch(webDisplay, /const\s+SILENCE_DURATION\s*=\s*1000/, '网页显示端不应固定使用 1000ms 静音时长');

console.log('asr-memory-vad-unification.test.js: contract checks passed');
