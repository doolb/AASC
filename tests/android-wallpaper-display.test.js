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
