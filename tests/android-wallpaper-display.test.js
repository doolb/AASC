'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = value => fs.readFileSync(path.join(root, value), 'utf8');

test('壁纸复用前台显示端身份，显式壁纸身份不会覆盖持久身份', () => {
    const html = read('src/apps/web-mediacenter/ui/public/display.html');
    const start = html.indexOf('function getConfiguredDisplayId()');
    const end = html.indexOf('function applyLogReportConfig(', start);
    assert.ok(start >= 0 && end > start);
    const saved = { displayId: 'normal-display' };
    const sandbox = { URL, window: { location: { href: 'https://example.test/display?displayId=wallpaper-123&displayContext=wallpaper' } }, localStorage: { getItem: key => saved[key], setItem: (key, value) => { saved[key] = value; } } };
    vm.runInNewContext(html.slice(start, end), sandbox);
    assert.equal(sandbox.getPersistentDisplayId(), 'wallpaper-123');
    assert.equal(saved.displayId, 'normal-display');
    sandbox.window.location.href = 'https://example.test/display?displayContext=wallpaper';
    assert.equal(sandbox.getPersistentDisplayId(), 'normal-display');
    assert.equal(saved.displayId, 'normal-display');
    sandbox.window.location.href = 'https://example.test/display?displayId=offline-display';
    assert.equal(sandbox.getPersistentDisplayId(), 'offline-display');
    assert.equal(saved.displayId, 'offline-display');
});

test('壁纸短暂隐藏时保留共享页面和渲染器', () => {
    const manifest = read('src/apps/android-display/app/src/main/AndroidManifest.xml');
    const service = read('src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWallpaperService.kt');
    assert.match(manifest, /android:name="\.DisplayWallpaperService"[\s\S]*?android:permission="android.permission.BIND_WALLPAPER"/);
    assert.match(service, /if \(visible\) ensureRenderer\(surfaceHolder\)[\s\S]*?webView\?\.onPause\(\)/);
    assert.doesNotMatch(service, /webView\?\.destroy\(\)/);
    assert.match(service, /WallpaperDisplayCoordinator\.obtain/);
    assert.match(service, /VIRTUAL_DISPLAY_FLAG_PRESENTATION/);
    assert.match(service, /WallpaperDisplayCoordinator\.foreground/);
    assert.match(service, /ServerConfig\.OFFLINE_DISPLAY_ID else null/);
});

test('关闭任务仅重置本应用桌面壁纸，并保留锁屏壁纸', () => {
    const manifest = read('src/apps/android-display/app/src/main/AndroidManifest.xml');
    const coordinator = read('src/apps/android-display/app/src/main/java/com/aasc/display/WallpaperDisplayCoordinator.kt');
    assert.match(manifest, /android.permission.SET_WALLPAPER/);
    assert.match(coordinator, /manager\.wallpaperInfo\?\.component == component\)[\s\S]*?manager\.clear\(WallpaperManager\.FLAG_SYSTEM\)/);
    assert.doesNotMatch(coordinator, /manager\.clear\(WallpaperManager\.FLAG_LOCK/);
    for (const name of ['MainActivity', 'DisplayWallpaperService', 'NodeServerService']) {
        const source = read(`src/apps/android-display/app/src/main/java/com/aasc/display/${name}.kt`);
        assert.match(source, /WallpaperDisplayCoordinator\.suspendWallpaper\(this\)/);
    }
});

test('系统壁纸浮窗有权限保护，并随壁纸生命周期移除', () => {
    const manifest = read('src/apps/android-display/app/src/main/AndroidManifest.xml');
    const service = read('src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWallpaperService.kt');
    const overlay = read('src/apps/android-display/app/src/main/java/com/aasc/display/WallpaperOverlay.kt');
    const activity = read('src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt');
    assert.match(manifest, /android.permission.SYSTEM_ALERT_WINDOW/);
    assert.match(activity, /Settings\.ACTION_MANAGE_OVERLAY_PERMISSION/);
    assert.match(service, /if \(!isPreview && WallpaperDesktopTracker\.isDesktop != false\) webView\?\.let \{ overlay\.show\(it\) \}/);
    assert.match(service, /if \(desktop == false\) overlay\.hide\(\)/);
    assert.match(service, /onVisibilityChanged[\s\S]*?overlay\.hide\(\)/);
    assert.match(service, /private fun releaseRenderer\(\) \{\s*overlay\.hide\(\)/);
    assert.match(overlay, /Settings\.canDrawOverlays\(context\)/);
    assert.match(overlay, /TYPE_APPLICATION_OVERLAY/);
    assert.match(overlay, /handler\.removeCallbacks\(refresh\)/);
    assert.match(overlay, /handler\.removeCallbacks\(collapse\)/);
    assert.match(overlay, /postDelayed\(collapse, 5000\)/);
    assert.match(overlay, /overlaySnapshot/);
    assert.match(overlay, /overlayAction/);
});

test('壁纸录音仅在壁纸可见且系统已授权时允许，摄像头仍只在前台开放', () => {
    const coordinator = read('src/apps/android-display/app/src/main/java/com/aasc/display/WallpaperDisplayCoordinator.kt');
    const view = read('src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt');
    const service = read('src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWallpaperService.kt');
    assert.match(coordinator, /isWallpaperAudioCaptureAllowed = \{ wallpaperActive && wallpaperVisible && !wallpaperSuspended \}/);
    assert.match(view, /checkSelfPermission\(context, Manifest\.permission\.RECORD_AUDIO\)/);
    assert.match(view, /RESOURCE_AUDIO_CAPTURE && \(foreground \|\| wallpaperAudio\)/);
    assert.match(view, /RESOURCE_VIDEO_CAPTURE && foreground/);
    assert.match(service, /setWallpaperVisible\(visible && !isPreview\)/);
});

test('壁纸浮窗隐藏前保存状态，重新显示按测量尺寸恢复贴边和收起', () => {
    const overlay = read('src/apps/android-display/app/src/main/java/com/aasc/display/WallpaperOverlay.kt');
    const showStart = overlay.indexOf('    fun show(webView: WebView)');
    const showEnd = overlay.indexOf('    private fun invoke(', showStart);
    const hideStart = overlay.indexOf('    fun hide()');
    assert.ok(showStart >= 0 && showEnd > showStart && hideStart > showEnd);
    const show = overlay.slice(showStart, showEnd);
    const hide = overlay.slice(hideStart, overlay.indexOf('    private fun parseColor', hideStart));
    assert.match(show, /val saved = loadPosition\(\)/);
    assert.match(show, /expanded\.visibility = if \(collapsed\) View\.GONE else View\.VISIBLE/);
    assert.match(show, /tab\.visibility = if \(collapsed\) View\.VISIBLE else View\.GONE/);
    assert.match(show, /outer\.measure\([\s\S]*saved\.resolve\(/);
    assert.match(hide, /savePosition\(\)[\s\S]*root = null/);
});
