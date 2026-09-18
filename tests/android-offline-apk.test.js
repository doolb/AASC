'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const rootDir = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('离线 APK npm 命令使用 allserver profile 和独立输出文件', () => {
    const packageJson = JSON.parse(read('package.json'));
    const buildScript = read('scripts/ops/build-apk.js');

    assert.match(packageJson.scripts['build:apk:offline'], /build-apk\.js allserver/u);
    assert.match(buildScript, /-PaascOffline=\$\{profile\.offline\}/u);
    assert.match(buildScript, /aasc-display-offline\.apk/u);
});

test('离线 APK 构建包含用户任务并在 Gradle 完成后清理 Daemon', () => {
    const buildScript = read('scripts/ops/build-apk.js');

    assert.match(buildScript, /includeOfflineTasks:\s*true/u);
    assert.match(buildScript, /runtimeContext\.taskDir/u);
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

test('offline APK WebView 录音声明 Android 音频采集所需权限', () => {
    const manifest = read('src/apps/android-display/app/src/main/AndroidManifest.xml');

    assert.match(manifest, /android\.permission\.RECORD_AUDIO/u);
    assert.match(
        manifest,
        /android\.permission\.MODIFY_AUDIO_SETTINGS/u,
        'WebView getUserMedia 需要 MODIFY_AUDIO_SETTINGS 才能创建录音设备'
    );
});

test('offline APK 启动按录音、摄像头、通知顺序串行申请权限', () => {
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );
    const requestStart = activity.indexOf('private fun requestNextStartupPermission()');
    const requestEnd = activity.indexOf('private fun continueStartupAfterStoragePermission()', requestStart);
    const callbackStart = activity.indexOf('override fun onRequestPermissionsResult(');
    const callbackEnd = activity.indexOf('override fun onActivityResult(', callbackStart);
    const requestFlow = activity.slice(requestStart, requestEnd);
    const permissionCallback = activity.slice(callbackStart, callbackEnd);

    assert.ok(requestStart >= 0 && requestEnd > requestStart, '应有独立的启动权限队列');
    assert.ok(callbackStart >= 0 && callbackEnd > callbackStart, '应能定位权限回调');
    assert.ok(
        requestFlow.indexOf('requestAudioPermissionIfNeeded()')
            < requestFlow.indexOf('requestCameraPermissionIfNeeded()'),
        '录音权限必须先于摄像头权限请求'
    );
    assert.ok(
        requestFlow.indexOf('requestCameraPermissionIfNeeded()')
            < requestFlow.indexOf('requestNotificationPermissionIfNeeded()'),
        '摄像头权限必须先于通知权限请求'
    );
    assert.match(requestFlow, /startupPermissionIndex/u);
    assert.match(requestFlow, /if\s*\(shouldWaitForResult\)\s*return/u);
    assert.match(requestFlow, /webView\?\.reload\(\)/u);
    assert.match(permissionCallback, /REQ_AUDIO_PERMISSION\s*->\s*\{[\s\S]*?requestNextStartupPermission\(\)/u);
    assert.match(permissionCallback, /REQ_CAMERA_PERMISSION\s*->\s*\{[\s\S]*?requestNextStartupPermission\(\)/u);
    assert.match(permissionCallback, /REQ_NOTIFICATION_PERMISSION\s*->\s*requestNextStartupPermission\(\)/u);
});

test('显示端控制端按钮位于 WebView 容器左上角且保留浮层布局', () => {
    const layout = read('src/apps/android-display/app/src/main/res/layout/activity_main.xml');
    const strings = read('src/apps/android-display/app/src/main/res/values/strings.xml');
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );
    const controlButton = layout.match(/<Button\s+android:id="@\+id\/controlToggleButton"[\s\S]*?\/>/u)?.[0];
    assert.ok(controlButton, '控制端按钮应作为 webContainer 中的原生顶层按钮存在');
    assert.match(controlButton, /android:layout_gravity="top\|start"/u);
    assert.match(controlButton, /android:layout_margin="12dp"/u);
    assert.match(controlButton, /android:elevation="12dp"/u);
    assert.match(activity, /controlPageUrl/u);
    assert.match(strings, /name="control_page">控制端/u);
});

test('Offline APK 右下角显示分辨率DPI和缩放诊断信息', () => {
    const layout = read('src/apps/android-display/app/src/main/res/layout/activity_main.xml');
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );
    const diagnostic = layout.match(
        /<TextView\s+android:id="@\+id\/offlineDisplayInfo"[\s\S]*?\/>/u
    )?.[0];

    assert.ok(diagnostic, '应有 Offline 诊断信息 TextView');
    assert.match(diagnostic, /android:layout_gravity="bottom\|end"/u);
    assert.match(diagnostic, /android:clickable="false"/u);
    assert.match(diagnostic, /android:elevation="8dp"/u);
    assert.match(activity, /offlineDisplayInfo/u);
    assert.match(activity, /metrics\.densityDpi/u);
    assert.match(activity, /WebViewScalePolicy\.initialScalePercent/u);
    assert.match(activity, /onConfigurationChanged/u);
    assert.match(activity, /缩放/u);
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

test('min 更新需要手动确认下载并显示浮动进度', () => {
    const layout = read('src/apps/android-display/app/src/main/res/layout/activity_main.xml');
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );
    const strings = read('src/apps/android-display/app/src/main/res/values/strings.xml');

    assert.match(layout, /offlineUpdatePanel/u);
    assert.match(layout, /offlineUpdateProgress/u);
    assert.match(layout, /offlineUpdateDownload/u);
    assert.match(layout, /offlineUpdateLater/u);
    assert.match(activity, /checkForMinApkUpdate/u);
    assert.match(activity, /showMinApkUpdatePrompt/u);
    assert.match(activity, /startMinApkDownload/u);
    assert.match(activity, /offlineUpdateDownload.setOnClickListener/u);
    assert.match(activity, /offlineUpdateLater.setOnClickListener/u);
    const checkStart = activity.indexOf('private fun checkForMinApkUpdateOnce()');
    const promptStart = activity.indexOf('private fun showMinApkUpdatePrompt', checkStart);
    const downloadStart = activity.indexOf('private fun startMinApkDownload()');
    const progressStart = activity.indexOf('private fun updateMinApkProgress', downloadStart);
    assert.ok(checkStart >= 0 && promptStart > checkStart, '应能定位仅检查更新的启动流程');
    assert.ok(downloadStart >= 0 && progressStart > downloadStart, '应能定位用户点击后的下载流程');
    assert.match(activity.slice(checkStart, promptStart), /checkForMinApkUpdate\(/u);
    assert.doesNotMatch(activity.slice(checkStart, promptStart), /checkAndPrepareMinApkUpdate\(/u);
    assert.match(activity.slice(downloadStart, progressStart), /checkAndPrepareMinApkUpdate\(/u);
    assert.match(strings, /name="offline_update_download"/u);
    assert.match(strings, /name="offline_update_later"/u);
});

test('Offline 热更外网源使用域名解析后的 IP 且不覆盖 Host', () => {
    const manager = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/OfflineUpdateManager.kt'
    );

    assert.match(manager, /WAN_BASE_URL\s*=\s*"http:\/\/c\.aasc\.us\/mnt\/aasc-offline\/"/u);
    assert.match(manager, /InetAddress\.getAllByName/u);
    assert.match(manager, /replaceUpdateUrlHost/u);
    assert.doesNotMatch(manager, /setRequestProperty\(\s*["']Host["']/u);
});

test('min 更新下载回调报告字节进度并通过安装广播更新状态', () => {
    const manager = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/OfflineUpdateManager.kt'
    );
    const receiver = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/OfflineApkInstallReceiver.kt'
    );
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );

    assert.match(manager, /data class OfflineUpdateProgress/u);
    assert.match(manager, /onProgress:\s*\(\(\s*OfflineUpdateProgress/u);
    assert.match(manager, /OfflineUpdateProgress\(\s*"downloading"/u);
    assert.match(manager, /completedBytes/u);
    assert.match(manager, /totalBytes/u);
    assert.match(receiver, /ACTION_INSTALL_STATUS/u);
    assert.match(receiver, /EXTRA_INSTALL_STATUS/u);
    assert.match(activity, /minInstallStatusReceiver/u);
    assert.match(activity, /registerReceiver\(minInstallStatusReceiver/u);
});

test('首包 Runtime 解压按 Runtime、源码、依赖和元数据报告阶段进度', () => {
    const installer = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt'
    );
    const service = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt'
    );
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );

    assert.match(installer, /data class RuntimeInstallProgress/u);
    assert.match(installer, /runtime_libraries/u);
    assert.match(installer, /server_source/u);
    assert.match(installer, /node_dependencies/u);
    assert.match(installer, /config_and_metadata/u);
    assert.match(installer, /onProgress:\s*\(\(\s*RuntimeInstallProgress/u);
    assert.match(service, /EXTRA_PHASE/u);
    assert.match(service, /EXTRA_COMPLETED_BYTES/u);
    assert.match(service, /EXTRA_TOTAL_BYTES/u);
    assert.match(activity, /completedBytes/u);
    assert.match(activity, /totalBytes/u);
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

    assert.match(activity, /setControlPageAccess\(if \(embeddedNode\) offlineMode else false\)/u);
    assert.match(activity, /val effectiveAllowed\s*=\s*embeddedNode\s*&&\s*\(offlineMode\s*\|\|\s*allowed\)/u);
    assert.match(activity, /controlPageAllowed\s*=\s*effectiveAllowed/u);
});

test('控制端 WebView 位于显示端 WebView 之上且按钮保持可关闭', () => {
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );

    assert.match(
        activity,
        /webContainer\.addView\(wv,\s*0\)[\s\S]*webContainer\.addView\(control,\s*1\)/u
    );
    assert.doesNotMatch(activity, /webContainer\.addView\(control,\s*0\)/u);
});

test('Offline 返回键关闭控制页并恢复浮动按钮，不回退 WebView 历史', () => {
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );

    assert.match(activity, /onBackPressedDispatcher\.addCallback/u);
    assert.match(activity, /private fun handleBackNavigation\(\)/u);
    assert.match(activity, /restoreControlPageButton/u);
    assert.match(activity, /controlWebView\?\.visibility\s*=\s*View\.GONE/u);
    assert.match(activity, /if\s*\(offlineMode\s*&&\s*webView\?\.visibility\s*==\s*View\.VISIBLE\s*&&\s*controlPageAllowed\)/u);
    assert.doesNotMatch(activity, /webView\?\.goBack\(\)|controlWebView\?\.goBack\(\)/u);
});

test('Offline APK 使用专用固定 displayId 并让 release 任务目标保持一致', () => {
    const serverConfig = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/ServerConfig.kt'
    );
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );
    const service = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt'
    );
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    const releaseResult = JSON.parse(read('release/task/render-display/results/index.json'));
    const devResult = JSON.parse(read('res/tasks/render-display/results/index.json'));

    assert.match(serverConfig, /OFFLINE_DISPLAY_ID\s*=\s*"offline-display"/u);
    assert.match(activity, /val displayId = if \(offlineMode\) ServerConfig\.OFFLINE_DISPLAY_ID/u);
    assert.match(activity, /ServerConfig\.pageUrl\(mainServerUrl, displayId\)/u);
    assert.match(service, /migrateOfflineDisplayTaskIndex/u);
    assert.match(service, /res\/tasks\/render-display\/results\/index\.json/u);
    assert.match(display, /searchParams\.get\(['"]displayId['"]\)/u);
    assert.match(display, /configuredDisplayId|configuredId/u);
    assert.equal(releaseResult.instances[0].displayId, 'offline-display');
    assert.equal(devResult.instances[0].displayId, 'offline-display');
});

test('原生 Chat2API 登录页在取消前提供完成按钮并支持即时捕获', () => {
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiLoginActivity.kt'
    );
    const authWebView = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiAuthWebView.kt'
    );
    const completeIndex = activity.indexOf('text = "完成"');
    const cancelIndex = activity.indexOf('text = "取消"');

    assert.ok(completeIndex >= 0, '登录页顶部必须有原生完成按钮');
    assert.ok(cancelIndex > completeIndex, '完成按钮必须位于取消按钮之前');
    assert.match(activity, /completeCapture/u);
    assert.match(authWebView, /fun completeCapture/u);
    assert.match(authWebView, /hasRequiredFields/u);
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

test('离线 APK 将 Qwen MNNChat 作为默认模型并按需物化显示端资产', () => {
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
    assert.match(manager, /models[\\/]llm[\\/]bundled/u);
    assert.match(manager, /AssetManager/u);
    assert.match(manager, /ensureBundledModelFromAssets/u);
    assert.match(manager, /bundledModelRoot\.isDirectory\s*\|\|\s*bundledModelRoot\.mkdirs\(\)/u);
    assert.match(manager, /remoteModelManager\.ensureModel/u);
    assert.match(manager, /candidate\.load\(modelDirectory\)/u);
    assert.match(activity, /NativeBridge\(wv, audioFocusController, offlineMode\)/u);
    assert.match(installer, /bundled-manifest\.json/u);
    assert.match(installer, /\.manifest\.json/u);
    assert.match(installer, /modelAssets/u);
});

test('offline 原生 ASR/TTS 优先复用 aasc-server/res/models 且首次配置不覆盖用户数据', () => {
    const bridge = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt'
    );
    const asr = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelManager.kt'
    );
    const tts = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/TtsModelManager.kt'
    );
    const prepare = read('scripts/ops/prepare-android-node-runtime.js');
    const installer = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt'
    );

    assert.match(bridge, /aasc-server[\\/]res[\\/]models/u);
    assert.match(bridge, /AsrModelManager\([\s\S]{0,300}offlineVoiceModelDirectory\("sensevoice"\)/u);
    assert.match(bridge, /TtsModelManager\([\s\S]{0,300}offlineVoiceModelDirectory\("tts"\)/u);
    assert.match(asr, /modelDirectory: File\?/u);
    assert.match(tts, /modelDirectory: File\?/u);
    assert.match(tts, /manifest\.json/u);
    assert.match(prepare, /offline-config\.json/u);
    assert.match(installer, /offline-config\.json/u);
    assert.match(installer, /config\/config\.json/u);
});

test('offline Runtime 首次安装在校验后直接原子切换，避免模型二次复制', () => {
    const installer = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt'
    );

    assert.match(installer, /staging\.renameTo\(root\)/u);
    assert.match(installer, /moveMutableDirectories/u);
    assert.doesNotMatch(
        installer,
        /replaceDirectory\(root,\s*staging,\s*"res\/models"\)/u
    );
});

test('Gradle 支持 embeddedNode 和 profile 独立 build directory', () => {
    const gradle = read('src/apps/android-display/app/build.gradle.kts');
    const activity = read('src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt');

    assert.match(gradle, /aasc_embedded_node/u);
    assert.match(gradle, /aascBuildDirectory|aascBuildDir/u);
    assert.match(activity, /aasc_embedded_node|embeddedNode/u);
    assert.match(activity, /startForegroundService[\s\S]*embeddedNode/u);
});

test('Runtime 安装器恢复 task results marker', () => {
    const installer = read('src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt');

    assert.match(installer, /resultsDirectory,\s*"latest"/u);
    assert.match(installer, /task-links/u);
    assert.match(installer, /status.*running|restoreAutoStartServices/u);
});
