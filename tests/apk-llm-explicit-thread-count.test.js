'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('MNN-LLM 显式使用 CPU policy 的线程数并保留 affinity 状态', () => {
    const engine = read('src/apps/android-display/app/src/main/java/com/aasc/display/MnnLlmEngine.kt');
    const manager = read('src/apps/android-display/app/src/main/java/com/aasc/display/MnnLlmModelManager.kt');
    const bridge = read('src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
    const nativeBridge = read('src/apps/android-display/app/src/main/cpp/aasc_mnn_jni.cpp');

    assert.match(engine, /\.put\("thread_num", threadCount\)/);
    assert.match(engine, /val threadCount = policy\?\.totalCoreCount\?\.coerceAtLeast\(1\) \?: 1/);
    assert.match(engine, /CpuAffinity\.applyCurrentThread\(it\.cpuMask\)/);
    assert.match(engine, /fun threadCount\(\): Int/);
    assert.match(manager, /threadCount = cpuPolicy\?\.totalCoreCount\?\.coerceAtLeast\(1\) \?: 1/);
    assert.match(manager, /selectedCpus = cpuPolicy\?\.selectedCpus \?: emptyList\(\)/);
    assert.match(manager, /cpuMask = cpuPolicy\?\.cpuMask \?: 0L/);
    assert.match(bridge, /\.put\("threadCount", policy\.totalCoreCount\.coerceAtLeast\(1\)\)/);
    assert.match(nativeBridge, /options\.value\("thread_num", 0\)/);
    assert.match(nativeBridge, /缺少有效 thread_num/);
});
