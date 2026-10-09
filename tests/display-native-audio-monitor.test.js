'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// 运行真实 PCM 采集器和页面绘图代码，直接观察画布柱高与信号生命周期。
function createHarness() {
    let now = 10000;
    let frames = 0;
    const bars = [];
    const context2d = {
        clearRect() { bars.length = 0; },
        fillRect(x, y, width, height) { bars.push(height); },
        globalAlpha: 1
    };
    const sandbox = vm.createContext({
        window: {}, atob: value => Buffer.from(value, 'base64').toString('binary'),
        Date: { now: () => now },
        document: { getElementById: () => ({ width: 140, height: 50, getContext: () => context2d }) },
        isListening: true, globalRecordingPaused: false, ttsRecordingPaused: false,
        pcmCapture: null, analyser: null,
        requestAnimationFrame() { frames += 1; }
    });
    const publicRoot = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    vm.runInContext(fs.readFileSync(path.join(publicRoot, 'js/pcm-audio-capture.js'), 'utf8'), sandbox);
    const html = fs.readFileSync(path.join(publicRoot, 'display.html'), 'utf8');
    vm.runInContext(html.slice(html.indexOf('let monitorTime = 0;'), html.indexOf('function sendCanvasSize()')), sandbox);
    const capture = new sandbox.window.NativePcmAudioCapture({ streamOnly: true }).start();
    sandbox.pcmCapture = capture;
    return {
        sandbox, capture, bars, context2d,
        setNow(value) { now = value; },
        frame(timestamp) { sandbox.animateMonitor(timestamp); },
        get frames() { return frames; },
        feed(amplitude) {
            const buffer = Buffer.alloc(3200);
            for (let index = 0; index < 1600; index += 1) {
                buffer.writeInt16LE(Math.round(Math.sin(index * Math.PI / 8) * amplitude * 32767), index * 2);
            }
            capture.feedPcm16(buffer.toString('base64'), 16000);
        }
    };
}

test('原生 AudioRecord 无 AnalyserNode 时，柱高随真实 PCM 音量变化', () => {
    const h = createHarness();
    h.feed(0);
    h.frame(100);
    assert.equal(h.bars.length, 35);
    assert.equal(h.bars[0], 1);
    h.feed(0.02);
    for (let time = 200; time <= 600; time += 100) h.frame(time);
    const quietHeight = h.bars[0];
    assert.ok(quietHeight > 5 && quietHeight < 20);
    h.feed(0.2);
    for (let time = 700; time <= 1100; time += 100) h.frame(time);
    assert.ok(h.bars[0] > quietHeight * 2);
    assert.ok(h.bars.every(height => height === h.bars[0]), '原生 RMS 柱表达统一音量');
    assert.equal(h.context2d.globalAlpha, 1);
    assert.equal(h.frames, 12, '初始化及每帧均只请求一次动画');
});

test('原生信号过期后衰减，暂停恢复和停止清除旧音量', () => {
    const h = createHarness();
    h.feed(0.5);
    h.frame(100);
    h.frame(200);
    const activeHeight = h.bars[0];
    h.setNow(10501);
    for (let time = 300; time <= 1200; time += 100) h.frame(time);
    assert.ok(h.bars[0] < activeHeight / 10);
    h.setNow(11000);
    h.feed(0.5);
    h.capture.setPaused(true);
    assert.equal(h.capture.latestRms, 0);
    assert.equal(h.capture.latestLevelAt, 0);
    h.feed(1);
    assert.equal(h.capture.latestRms, 0);
    h.frame(1300);
    assert.ok(h.bars[0] <= 8, '暂停显示待机柱');
    h.capture.setPaused(false);
    h.frame(1400);
    assert.equal(h.bars[0], 1, '恢复但未收到新信号时不能显示旧柱高');
    h.feed(0.5);
    h.frame(1500);
    assert.ok(h.bars[0] > 20);
    h.capture.stop();
    assert.equal(h.capture.latestRms, 0);
    assert.equal(h.capture.latestLevelAt, 0);
    h.sandbox.isListening = false;
    h.frame(1600);
    assert.ok(h.bars[0] <= 8);
});

test('暂停或 TTS 时不显示原生旧信号，浏览器频谱继续复用数组', () => {
    const h = createHarness();
    h.feed(0.5);
    h.sandbox.ttsRecordingPaused = true;
    h.frame(100);
    assert.ok(h.bars[0] <= 8);
    h.sandbox.ttsRecordingPaused = false;
    h.sandbox.globalRecordingPaused = true;
    h.frame(200);
    assert.ok(h.bars[0] <= 8);
    h.sandbox.globalRecordingPaused = false;
    h.sandbox.pcmCapture = { active: true, paused: false };
    const arrays = [];
    h.sandbox.analyser = { frequencyBinCount: 128, getByteFrequencyData(data) { arrays.push(data); data.fill(128); } };
    h.frame(300);
    h.frame(400);
    assert.equal(arrays.length, 2);
    assert.equal(arrays[0], arrays[1]);
    assert.ok(h.bars[0] > 20 && h.bars[0] < 30);
    assert.equal(h.context2d.globalAlpha, 1);
});
