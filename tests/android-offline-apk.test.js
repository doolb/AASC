'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const rootDir = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('离线 APK npm 命令使用独立 Gradle 标识并重命名 APK', () => {
    const packageJson = JSON.parse(read('package.json'));
    const buildScript = read('scripts/ops/build-offline-apk.js');

    assert.match(packageJson.scripts['build:apk:offline'], /build-offline-apk/u);
    assert.match(buildScript, /aascOffline=true/u);
    assert.match(buildScript, /aasc-display-offline\.apk/u);
});

test('离线 APK 构建包含用户任务并在 Gradle 完成后清理 Daemon', () => {
    const buildScript = read('scripts/ops/build-offline-apk.js');

    assert.match(buildScript, /includeOfflineTasks:\s*true/u);
    assert.match(buildScript, /res.*tasks/u);
    assert.match(buildScript, /--stop/u);
    assert.match(buildScript, /--no-daemon/u);
    assert.match(buildScript, /kotlin-compiler-in-aascdisplay-/u);
});

test('Gradle 离线属性使用独立 applicationId、label 和版本后缀', () => {
    const gradle = read('src/apps/android-display/app/build.gradle.kts');
    const manifest = read('src/apps/android-display/app/src/main/AndroidManifest.xml');

    assert.match(gradle, /com\.aasc\.display\.offline/u);
    assert.match(gradle, /-offline/u);
    assert.match(manifest, /\$\{appLabel\}/u);
});

test('显示端布局将控制端按钮放在 WebView 容器的顶层', () => {
    const layout = read('src/apps/android-display/app/src/main/res/layout/activity_main.xml');
    const strings = read('src/apps/android-display/app/src/main/res/values/strings.xml');
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );
    assert.match(layout, /controlToggleButton/u);
    assert.match(activity, /controlPageUrl/u);
    assert.match(strings, /name="control_page">控制端/u);
});

test('offline APK 首次解包显示原生启动状态遮罩', () => {
    const layout = read('src/apps/android-display/app/src/main/res/layout/activity_main.xml');
    const strings = read('src/apps/android-display/app/src/main/res/values/strings.xml');

    assert.match(layout, /offlineStartupPanel/u);
    assert.match(layout, /offlineStartupProgress/u);
    assert.match(layout, /offlineStartupMessage/u);
    assert.match(layout, /offlineStartupRetry/u);
    assert.match(strings, /name="offline_startup_installing"/u);
    assert.match(strings, /name="offline_startup_failed"/u);
    assert.match(strings, /name="offline_startup_retry"/u);
});

test('offline APK 消费 Node 状态并持续等待本地 display 服务', () => {
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );
    const service = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt'
    );

    assert.match(activity, /NodeServerService\.ACTION_STATUS/u);
    assert.match(activity, /offlineStartupRetry/u);
    assert.match(activity, /registerNodeStatusReceiver/u);
    assert.match(activity, /unregisterNodeStatusReceiver/u);
    assert.match(activity, /maxOfflineDisplayRetries\s*=\s*300/u);
    assert.match(service, /STATUS_INSTALLING/u);
    assert.match(service, /STATUS_FAILED/u);
    assert.match(service, /sendStatus/u);
});

test('控制端按钮由服务端 Android 能力和开放状态共同控制', () => {
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );
    const display = read('src/apps/web-mediacenter/ui/public/display.html');

    assert.match(activity, /private fun setControlPageAccess\(allowed: Boolean\)/u);
    assert.match(activity, /AndroidControlAccess\.shouldShowButton/u);
    assert.match(display, /displayControlAccess/u);
    assert.doesNotMatch(activity, /controlToggleButton\.visibility\s*=\s*if\s*\(offlineMode\)/u);
});

test('offline APK 默认显示控制端入口且不受服务端默认关闭值影响', () => {
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );

    assert.match(activity, /setControlPageAccess\(offlineMode\)/u);
    assert.match(activity, /val effectiveAllowed\s*=\s*offlineMode\s*\|\|\s*allowed/u);
    assert.match(activity, /controlPageAllowed\s*=\s*effectiveAllowed/u);
});

test('offline 启动遮罩不会被错误页 onPageFinished 隐藏', () => {
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );

    assert.match(activity, /private var offlineDisplayLoadFailed\s*=\s*false/u);
    assert.match(activity, /offlineDisplayLoadFailed\s*=\s*true/u);
    assert.match(activity, /retryOfflinePage\s*&&\s*!offlineDisplayLoadFailed/u);
    assert.match(activity, /isDisplayPageUrl\(pageUrl, baseUrl\)/u);
});

test('离线 APK 将 Qwen MNNChat 作为默认模型并直接加载安装目录', () => {
    const bridge = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt'
    );
    const manager = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MnnLlmModelManager.kt'
    );
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );
    const installer = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt'
    );

    assert.match(bridge, /DEFAULT_OFFLINE_LLM_MODEL_ID/u);
    assert.match(bridge, /ensureDefaultModel\(\)/u);
    assert.match(manager, /bundledModelId/u);
    assert.match(manager, /aasc-server[\\/]res[\\/]models[\\/]llm/u);
    assert.match(manager, /remoteModelManager\.ensureModel/u);
    assert.match(manager, /candidate\.load\(modelDirectory\)/u);
    assert.match(activity, /NativeBridge\(wv, audioFocusController, offlineMode\)/u);
    assert.match(installer, /bundled-manifest\.json/u);
    assert.match(installer, /\.manifest\.json/u);
});
