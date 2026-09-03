const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('android ASR build script and project exist', () => {
  const pkg = JSON.parse(read('3rd/tts-server/package.json'));
  assert.match(pkg.scripts['build:android-asr'], /android-asr/);
  assert.equal(fs.existsSync(path.join(ROOT, '3rd/tts-server/android-asr/app/build.gradle.kts')), true);
});

test('android ASR package declares required offline model and HTTP permissions', () => {
  const build = read('3rd/tts-server/android-asr/app/build.gradle.kts');
  const manifest = read('3rd/tts-server/android-asr/app/src/main/AndroidManifest.xml');
  assert.match(build, /model\.int8\.onnx/);
  assert.match(build, /tokens\.txt/);
  assert.match(build, /arm64-v8a/);
  assert.match(manifest, /RECORD_AUDIO/);
  assert.match(manifest, /INTERNET/);
});

test('android ASR UI and HTTP endpoints are present', () => {
  const layout = read('3rd/tts-server/android-asr/app/src/main/res/layout/activity_main.xml');
  const server = read('3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrHttpServer.kt');
  const page = read('3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrWebPage.kt');
  assert.match(layout, /recordButton/);
  assert.match(layout, /selectAudioButton/);
  assert.match(layout, /recognizeButton/);
  assert.match(layout, /resultText/);
  assert.match(layout, /cpuModeSpinner/);
  assert.match(server, /"\/health"/);
  assert.match(server, /"\/api\/asr"/);
  assert.match(server, /val route = request\.path\.substringBefore/);
  assert.match(server, /request\.method == "GET" && \(route == "\/" \|\| route == "\/index\.html"\)/);
  assert.match(server, /18080/);
  assert.match(page, /fetch\('\/api\/asr\?/);
  assert.match(page, /type="file"/);
  assert.match(page, /getUserMedia/);
  assert.match(page, /AudioContext/);
  assert.match(page, /录音/);
});
