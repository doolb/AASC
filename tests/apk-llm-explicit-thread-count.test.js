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

test('JNI 将配置线程数写入官方 LlmSession 主配置', () => {
    const nativeBridge = read('src/apps/android-display/app/src/main/cpp/aasc_mnn_jni.cpp');

    assert.match(nativeBridge, /json sessionConfig = json::object\(\);/);
    assert.match(nativeBridge, /sessionConfig\["thread_num"\] = threadNum;/);
    assert.match(nativeBridge, /sessionConfig\["mllm"\]\["thread_num"\] = threadNum;/);
    assert.match(nativeBridge, /options\.erase\("thread_num"\);/);
    assert.match(nativeBridge, /new mls::LlmSession\(\s*toString\(env, configPath\),\s*sessionConfig,\s*options,/s);
    assert.doesNotMatch(nativeBridge, /new mls::LlmSession\(\s*toString\(env, configPath\),\s*json::object\(\),\s*options,/s);
});

test('LLM CPU 配置变化后下一条请求换代 MNN runtime', () => {
    const manager = read('src/apps/android-display/app/src/main/java/com/aasc/display/MnnLlmModelManager.kt');
    const bridge = read('src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');

    assert.match(manager, /private var cpuPolicyGeneration = 0L/);
    assert.match(manager, /private var loadedCpuPolicyGeneration = -1L/);
    assert.match(manager, /fun onCpuPolicyChanged\(\)/);
    assert.match(manager, /loadedCpuPolicyGeneration\s*(?:!=|==)\s*cpuPolicyGeneration/);
    assert.match(manager, /val engine = ensureEngineForCurrentCpuPolicy\(\)/);
    assert.match(manager, /candidate = MnnLlmEngine\(cpuPolicyProvider\)/);
    assert.match(manager, /candidate\.load\(modelDirectory\)/);
    assert.match(bridge, /llmCpuPolicy = llmPolicy[\s\S]*?llmModelManager\.onCpuPolicyChanged\(\)/);
});

test('推理结束后预检查模型身份和线程数，并在下一次推理前再次校验', () => {
    const manager = read('src/apps/android-display/app/src/main/java/com/aasc/display/MnnLlmModelManager.kt');

    assert.match(manager, /private var loadedModelId: String\? = null/);
    assert.match(manager, /private var loadedRevision: String\? = null/);
    assert.match(manager, /loadedModelId\s*(?:==|!=)\s*(?:selectedModelId|expectedModelId)/);
    assert.match(manager, /loadedRevision\s*(?:==|!=)\s*(?:selectedRevision|expectedRevision)/);
    assert.match(manager, /current\.threadCount\(\) == expectedThreadCount/);
    assert.match(manager, /shouldReconcileRuntime/);
    assert.match(manager, /reconcileRuntimeAfterInference\(\)/);
    assert.match(manager, /\.put\("loadedModelId", loadedModelId/);
});
