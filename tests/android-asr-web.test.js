const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const projectRoot = path.resolve(__dirname, '..');
const webRoot = path.join(projectRoot, '3rd/tts-server/android-asr/web');
const outputRoot = path.join(projectRoot, '3rd/tts-server/android-asr/web-dist');

test('网页只使用 Apache 的基础模型路径，并隔离正式语音接口', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(webRoot, 'js/app.js'), 'utf8');
  const worker = fs.readFileSync(path.join(webRoot, 'js/asr-worker.js'), 'utf8');
  const authoredSource = `${html}\n${app}\n${worker}`;

  assert.match(app, /new URL\('\/mnt\/aimodel\/'/);
  assert.match(worker, /sensevoice\/model\.int8\.onnx/);
  assert.match(worker, /sensevoice\/tokens\.txt/);
  assert.match(worker, /3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k\.onnx/);
  assert.match(worker, /pyannote_segmentation_3_0_int8\.onnx/);
  assert.match(worker, /registeredEmbeddings = new Map\(\)/);
  assert.doesNotMatch(authoredSource, /localStorage\s*\.|indexedDB\s*\./);
  assert.doesNotMatch(authoredSource, /\/api\/(?:asr|voiceprint)\//);
  assert.doesNotMatch(html, /streamStart|streamFile|streamResult|流式识别/);
  assert.doesNotMatch(authoredSource, /gtcrn_simple|streaming-zipformer/);
});

test('音频统一为有效的 16 kHz PCM，并可编码为 WAV', async () => {
  const audioUtils = await import(pathToFileURL(path.join(webRoot, 'js/audio-utils.mjs')));
  const source = Float32Array.from([0, 0.5, -0.5, 1]);
  const resampled = audioUtils.resampleMono(source, 32000, 16000);
  assert.equal(resampled.length, 2);
  assert.deepEqual([...resampled], [0, -0.5]);

  const mixed = audioUtils.downmixAudioBuffer({
    sampleRate: 16000,
    numberOfChannels: 2,
    length: 3,
    getChannelData(channel) {
      return channel === 0 ? Float32Array.from([1, 0, -1]) : Float32Array.from([-1, 0.5, 1]);
    },
  });
  assert.deepEqual([...mixed], [0, 0.25, 0]);
  assert.equal(audioUtils.validateSamples(mixed), true);

  const wav = await audioUtils.encodePcm16Wav(mixed).arrayBuffer();
  const bytes = new Uint8Array(wav);
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString(), 'RIFF');
  assert.equal(Buffer.from(bytes.slice(8, 12)).toString(), 'WAVE');
  assert.equal(wav.byteLength, 44 + mixed.length * 2);
  assert.throws(() => audioUtils.validateSamples(new Float32Array(16000 * 61)), /60 秒/);
});

test('多人模式按连续 cluster 合并，短未知段仅在回查仍匹配时纳入注册说话人', async () => {
  const speakerUtils = require(path.join(webRoot, 'js/speaker-utils.js'));
  const merged = speakerUtils.mergeDiarizedSegments([
    { start: 1, end: 2, speaker: 0 },
    { start: 0, end: 1, speaker: 0 },
    { start: 2, end: 2.5, speaker: 1 },
    { start: 2.5, end: 2.2, speaker: 1 },
  ]);
  assert.deepEqual(merged, [
    { start: 0, end: 2, clusterId: 0 },
    { start: 2, end: 2.5, clusterId: 1 },
  ]);

  let rematchCount = 0;
  const accepted = await speakerUtils.resolveMatchedSegments([
    { start: 0, end: 1, clusterId: 0, match: { speaker: 'ZH' } },
    { start: 1.1, end: 1.5, clusterId: 1, match: { speaker: null } },
  ], async (start, end, clusterId) => {
    rematchCount += 1;
    return { start, end, clusterId, match: { speaker: 'ZH' } };
  });
  assert.equal(rematchCount, 1);
  assert.equal(accepted.length, 1);
  assert.deepEqual([accepted[0].start, accepted[0].end, accepted[0].clusterId], [0, 1.5, 0]);

  const rejected = await speakerUtils.resolveMatchedSegments([
    { start: 0, end: 1, clusterId: 0, match: { speaker: 'ZH' } },
    { start: 1.1, end: 1.3, clusterId: 1, match: { speaker: null } },
    { start: 1.4, end: 2, clusterId: 2, match: { speaker: 'EN' } },
  ], async (start, end, clusterId) => ({ start, end, clusterId, match: { speaker: 'ZH' } }));
  assert.equal(rejected.length, 3);
  assert.equal(speakerUtils.cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([1, 0])), 1);
  assert.equal(speakerUtils.cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0, 1])), 0);
});

test('静态构建包含 WASM、功能包装和许可，不打包同步模型', () => {
  execFileSync(process.execPath, [path.join(projectRoot, 'scripts/ops/build-android-asr-web.js')], {
    cwd: projectRoot,
    stdio: 'pipe',
  });

  for (const relativePath of [
    'index.html',
    'js/app.js',
    'js/asr-worker.js',
    'vendor/sherpa-onnx-wasm-combined.js',
    'vendor/sherpa-onnx-wasm-combined.wasm',
    'vendor/sherpa-onnx-speaker-id.js',
    'vendor/THIRD_PARTY_NOTICES.md',
    'vendor/licenses/MIT.txt',
    'vendor/licenses/Apache-2.0.txt',
  ]) {
    assert.ok(fs.statSync(path.join(outputRoot, relativePath)).size > 0, `${relativePath} should be built`);
  }
  assert.ok(fs.statSync(path.join(outputRoot, 'vendor/sherpa-onnx-wasm-combined.wasm')).size > 10 * 1024 * 1024);
  assert.equal(fs.existsSync(path.join(outputRoot, 'models')), false);
});
