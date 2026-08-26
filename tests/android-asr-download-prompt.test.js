const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const managerPath = path.join(
    __dirname,
    '..',
    'src',
    'apps',
    'android-display',
    'app',
    'src',
    'main',
    'java',
    'com',
    'aasc',
    'display',
    'AsrModelManager.kt'
);
const displayPath = path.join(
    __dirname,
    '..',
    'src',
    'apps',
    'web-mediacenter',
    'ui',
    'public',
    'display.html'
);

function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

test('APK ASR 模型进入下载状态时应立即回调 0% 提示', () => {
    const source = readSource(managerPath);
    const stateStart = source.indexOf('state = "downloading"');
    const backgroundStart = source.indexOf('downloadPool.execute', stateStart);

    assert.notEqual(stateStart, -1, '未找到下载状态切换');
    assert.notEqual(backgroundStart, -1, '未找到后台下载入口');

    const transitionBlock = source.slice(stateStart, backgroundStart);
    assert.match(
        transitionBlock,
        /postModelEvent\(JSONObject\(\)\.put\("state",\s*"downloading"\)\.put\("progress",\s*0\)/,
        '后台下载开始前应先回调 downloading 0%'
    );
});

test('APK 页面检测到模型下载中时应立即显示当前进度', () => {
    const source = readSource(displayPath);
    const nativeBranchStart = source.indexOf('if (nativeAsrAvailable) {', source.indexOf('async function detectCapabilities'));
    const nativeBranchEnd = source.indexOf('} else if (localAsrAvailable || voiceSupported)', nativeBranchStart);

    assert.notEqual(nativeBranchStart, -1, '未找到原生 ASR 能力探测分支');
    assert.notEqual(nativeBranchEnd, -1, '原生 ASR 能力探测分支缺少结束位置');

    const nativeBranch = source.slice(nativeBranchStart, nativeBranchEnd);
    assert.match(nativeBranch, /st\.state\s*===\s*['"]downloading['"]/, '应识别已有 downloading 状态');
    assert.match(nativeBranch, /showNativeAsrDownloadProgress\(st\.progress\)/, '检测到下载中时应立即显示提示');

    const progressHelperStart = source.indexOf('function showNativeAsrDownloadProgress');
    const progressHelperEnd = source.indexOf('        let logReportConfig', progressHelperStart);
    assert.notEqual(progressHelperStart, -1, '未找到原生 ASR 下载进度显示函数');
    assert.notEqual(progressHelperEnd, -1, '原生 ASR 下载进度显示函数缺少结束位置');
    const progressHelper = source.slice(progressHelperStart, progressHelperEnd);
    assert.match(progressHelper, /updateVoiceTextDisplay\(/, '下载进度函数应更新界面提示');
    assert.match(progressHelper, /:\s*0\s*;/, '没有进度时应显示 0%');
});

test('APK 页面能力检测不应在 capabilities 初始化期间写入 WebGPU 诊断字段', () => {
    const source = readSource(displayPath);
    const detectStart = source.indexOf('async function detectCapabilities');
    const detectEnd = source.indexOf('async function declareCapabilities', detectStart);
    const detectSource = source.slice(detectStart, detectEnd);

    assert.match(detectSource, /let webgpuDiag\s*=\s*['"]['"]/, '应使用独立变量暂存 WebGPU 诊断信息');
    assert.match(
        detectSource,
        /if\s*\(webgpuDiag\)\s*\{[\s\S]*?capabilities\._webgpuDiag\s*=\s*webgpuDiag/,
        '对象初始化完成后才能写入 WebGPU 诊断字段'
    );
    assert.doesNotMatch(
        detectSource,
        /capabilities\._webgpuDiag\s*=\s*diag\.join\(/,
        'WebGPU 异步初始化期间不能直接访问仍处于暂时性死区的 capabilities'
    );
});

test('APK 收到启用原生 ASR 配置且模型未就绪时应触发自动下载', () => {
    const source = readSource(displayPath);
    const configStart = source.indexOf("if (data.type === 'asrConfig')");
    const configEnd = source.indexOf("if (data.type === 'ttsConfig')", configStart);
    const configSource = source.slice(configStart, configEnd);

    assert.match(configSource, /st\.state\s*===\s*['"]not_ready['"]/, '应处理模型未下载状态');
    assert.match(configSource, /st\.state\s*===\s*['"]error['"]/, '应处理模型加载失败状态');
    assert.match(configSource, /nativeBridge\.asrEnsureModel\(\)/, '模型未就绪时应调用 asrEnsureModel');
});
