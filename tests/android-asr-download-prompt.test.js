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

test('APK 作为显示端 ASR 提供端时应检测并加载本地模型', () => {
    const source = readSource(displayPath);
    const detectStart = source.indexOf('async function detectCapabilities');
    const detectEnd = source.indexOf('async function declareCapabilities', detectStart);
    const detectSource = source.slice(detectStart, detectEnd);
    assert.match(detectSource, /if \(nativeAsrAvailable\)/);
    assert.match(detectSource, /state\.state\s*===\s*['"]downloading['"]/);
    assert.match(detectSource, /showNativeAsrDownloadProgress\(state\.progress\)/);
    assert.match(detectSource, /nativeBridge\.asrEnsureModel\(\)/);
    assert.match(source, /function showNativeAsrDownloadProgress/);
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

test('APK 提供端收到 ASR 配置且模型未就绪时应触发自动下载', () => {
    const source = readSource(displayPath);
    const configStart = source.indexOf("if (data.type === 'asrConfig')");
    const configEnd = source.indexOf("if (data.type === 'ttsConfig')", configStart);
    const configSource = source.slice(configStart, configEnd);

    assert.match(configSource, /asrLanguageMode\s*=\s*['"]zh['"]/);
    assert.match(configSource, /asrDenoiseEnabled\s*=\s*!!data\.denoise/);
    assert.match(configSource, /nativeBridge\.asrConfigure\(/);
    assert.match(configSource, /nativeBridge\.asrStatus\(\)/);
    assert.match(configSource, /nativeBridge\.asrEnsureModel\(\)/);
});
