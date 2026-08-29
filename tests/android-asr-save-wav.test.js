import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('测试 ASR 内置网页提供保存当前 WAV 按钮和下载逻辑', () => {
  const page = read('3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrWebPage.kt');

  assert.match(page, /id="saveCurrentAudio"/);
  assert.match(page, /保存当前 WAV/);
  assert.match(page, /saveCurrentAudio\.disabled/);
  assert.match(page, /download/);
  assert.match(page, /\.wav/);
});

test('测试 ASR Android UI 提供保存当前 WAV 按钮并绑定保存动作', () => {
  const layout = read('3rd/tts-server/android-asr/app/src/main/res/layout/activity_main.xml');
  const activity = read('3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/MainActivity.kt');

  assert.match(layout, /@\+id\/saveAudioButton/);
  assert.match(activity, /private lateinit var saveAudioButton: Button/);
  assert.match(activity, /saveAudioButton\.setOnClickListener/);
  assert.match(activity, /saveCurrentWav/);
});

test('Android WAV 保存器使用系统下载目录并在旧系统使用专属目录', () => {
  const saver = read('3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/WavFileSaver.kt');

  assert.match(saver, /MediaStore\.Downloads/);
  assert.match(saver, /Environment\.DIRECTORY_DOWNLOADS/);
  assert.match(saver, /getExternalFilesDir/);
  assert.match(saver, /WavAudio\.encode/);
  assert.match(saver, /audio\/wav/);
});

test('普通非流式识别固定中文且网页不再暴露语言选择', () => {
  const page = read('3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrWebPage.kt');
  const activity = read('3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/MainActivity.kt');

  assert.doesNotMatch(page, /id="languageMode"/);
  assert.match(page, /new URLSearchParams\(\{ language: 'zh' \}\)/);
  assert.match(page, /language: 'zh'/);
  assert.match(activity, /AsrLanguageMode\.ZH/);
});
