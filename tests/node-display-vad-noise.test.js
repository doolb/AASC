'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const main = read('src/apps/voice-display-node/main.js');
const recorder = read('src/apps/voice-display-node/audio-recorder.js');
const recorderPv = read('src/apps/voice-display-node/audio-recorder-pv.js');
const noiseHelper = read('src/apps/voice-display-node/vad-noise.js');
const { calculateNoiseStats } = require('../src/apps/voice-display-node/vad-noise');

assert.match(main, /case\s+['"]voiceVadNoiseTest['"]/, 'Node 子显示端应处理底噪检测消息');
assert.match(main, /voiceVadNoiseResult/, 'Node 子显示端应回传底噪检测结果');
assert.match(main, /startNoiseTest/, 'Node 子显示端应调用录音器底噪检测入口');
assert.match(recorder, /startNoiseTest/, 'naudiodon 录音器应支持底噪检测');
assert.match(recorderPv, /startNoiseTest/, 'PvRecorder 录音器应支持底噪检测');
assert.match(noiseHelper, /p95Rms/, '底噪统计应计算 P95');
assert.match(noiseHelper, /recommendedThreshold/, '底噪统计应计算建议阈值');

const stats = calculateNoiseStats([0.01, 0.02, 0.04, 0.03], 3000);
assert.equal(stats.sampleCount, 4);
assert.equal(stats.averageRms, 0.025);
assert.equal(stats.peakRms, 0.04);
assert.equal(stats.p95Rms, 0.04);
assert.equal(stats.recommendedThreshold, 0.06);

function loadRecorder(relativePath, nativeModuleName, nativeModule) {
    const source = read(relativePath);
    const sandbox = {
        Buffer,
        clearTimeout,
        console,
        Date,
        Math,
        Number,
        Promise,
        require(request) {
            if (request === nativeModuleName) return nativeModule;
            if (request === './vad-noise') {
                return require('../src/apps/voice-display-node/vad-noise');
            }
            throw new Error(`测试不支持依赖: ${request}`);
        },
        setTimeout,
        module: { exports: {} },
        exports: {}
    };
    vm.runInNewContext(source, sandbox, { filename: relativePath });
    return sandbox.module.exports;
}

test('PvRecorder 和 naudiodon 录音器复用当前帧完成底噪统计', async () => {
    const recorderClasses = [
        loadRecorder(
            'src/apps/voice-display-node/audio-recorder.js',
            'naudiodon',
            { SampleFormat16Bit: 1, getDevices: () => [] }
        ),
        loadRecorder(
            'src/apps/voice-display-node/audio-recorder-pv.js',
            '@picovoice/pvrecorder-node',
            { PvRecorder: class {} }
        )
    ];

    for (const Recorder of recorderClasses) {
        const instance = new Recorder({ sampleRate: 16000 });
        instance.recording = true;
        const resultPromise = instance.startNoiseTest(3000);
        instance.collectNoiseSample(0.01);
        instance.collectNoiseSample(0.02);
        instance.collectNoiseSample(0.04);
        instance.finishNoiseTest();

        const result = await resultPromise;
        assert.equal(result.sampleCount, 3);
        assert.equal(result.p95Rms, 0.04);
        assert.equal(result.recommendedThreshold, 0.06);
    }
});

test('录音器未启动、重复检测和暂停时返回底噪检测错误', async () => {
    const Recorder = loadRecorder(
        'src/apps/voice-display-node/audio-recorder-pv.js',
        '@picovoice/pvrecorder-node',
        { PvRecorder: class {} }
    );
    const instance = new Recorder();

    await assert.rejects(instance.startNoiseTest(3000), /录音器未启动/);

    instance.recording = true;
    const emptyResultPromise = instance.startNoiseTest(3000);
    instance.finishNoiseTest();
    await assert.rejects(emptyResultPromise, /未采集到麦克风数据/);

    const resultPromise = instance.startNoiseTest(3000);
    await assert.rejects(instance.startNoiseTest(3000), /已有底噪检测正在进行/);
    instance.pause();
    await assert.rejects(resultPromise, /录音器当前已暂停/);
});

console.log('node-display-vad-noise.test.js: contract checks passed');
