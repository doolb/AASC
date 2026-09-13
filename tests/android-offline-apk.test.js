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

test('只有离线模式连接后显示控制端按钮', () => {
    const activity = read(
        'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
    );

    assert.match(
        activity,
        /controlToggleButton\.visibility\s*=\s*if\s*\(offlineMode\)\s*View\.VISIBLE\s*else\s*View\.GONE/u
    );
});
