'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const display = fs.readFileSync(DISPLAY, 'utf8');

const finishStart = display.indexOf('async function finishVoiceSegment()');
const finishEnd = display.indexOf('async function startVoiceRecording()', finishStart);
const finishBody = display.slice(finishStart, finishEnd);
assert.ok(finishStart >= 0 && finishEnd > finishStart, '应能定位语音分段生命周期');
assert.match(finishBody, /takeRawPcmWav\(\)/, '语音分段结束应只提取并清空当前 PCM 缓冲');
assert.doesNotMatch(finishBody, /stopSilenceDetection\(\)/, '语音分段结束不应销毁 VAD AudioContext');
assert.doesNotMatch(finishBody, /stopRawPcmCapture\(\)/, '语音分段结束不应销毁 PCM AudioContext');

assert.match(display, /function releaseVoiceRecordingResources\(\)/, '应有统一的监听资源释放入口');
const recognitionStart = display.indexOf('async function sendAudioForRecognition');
const recognitionEnd = display.indexOf('// 只有服务器选中的 APK 提供端', recognitionStart);
const recognitionBody = display.slice(recognitionStart, recognitionEnd);
const ignoredStart = recognitionBody.indexOf("data.status === 'ignored'");
const ignoredEnd = recognitionBody.indexOf("} catch (e)", ignoredStart);
const ignoredBody = recognitionBody.slice(ignoredStart, ignoredEnd);
assert.match(ignoredBody, /releaseVoiceRecordingResources\(\)/, 'ignored 自动重启前应释放旧采集资源');

const startRecordingStart = display.indexOf('async function startVoiceRecording()');
const startRecordingEnd = display.indexOf('function startSilenceDetection()', startRecordingStart);
const startRecordingBody = display.slice(startRecordingStart, startRecordingEnd);
assert.match(startRecordingBody, /micStream && pcmCapture/, '重新进入监听时应优先复用已有麦克风和 PCM 采集链路');
assert.match(startRecordingBody, /!displayPageActive/, '页面离开后不应被延迟重启任务重新开启监听');

const pagehideStart = display.indexOf("window.addEventListener('pagehide'");
const pagehideEnd = display.indexOf("window.addEventListener('resize'", pagehideStart);
const pagehideBody = display.slice(pagehideStart, pagehideEnd);
assert.match(pagehideBody, /stopVoiceRecording\(\)/, '页面离开时应释放持续监听资源');

console.log('display-voice-resource-lifecycle.test.js: contract checks passed');
