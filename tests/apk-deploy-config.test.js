const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    DEFAULT_SERVER_URL,
    buildStartArgs,
    resolveServerUrl
} = require('../src/scripts/apk-deploy-config');

const MANIFEST = path.resolve(__dirname, '../src/apps/android-display/app/src/main/AndroidManifest.xml');

test('部署命令默认使用显示端服务器地址', () => {
    assert.equal(DEFAULT_SERVER_URL, 'https://192.168.1.39:8081');
    assert.equal(resolveServerUrl({}), DEFAULT_SERVER_URL);
});

test('部署命令支持环境变量覆盖服务器地址并去除首尾空格', () => {
    assert.equal(
        resolveServerUrl({ AASC_DISPLAY_SERVER_URL: '  https://example.test:8081  ' }),
        'https://example.test:8081'
    );
});

test('空环境变量回退到默认服务器地址', () => {
    assert.equal(resolveServerUrl({ AASC_DISPLAY_SERVER_URL: '   ' }), DEFAULT_SERVER_URL);
});

test('启动参数使用独立参数传递服务器地址', () => {
    assert.deepEqual(
        buildStartArgs('192.168.1.6:5555', DEFAULT_SERVER_URL),
        [
            '-s',
            '192.168.1.6:5555',
            'shell',
            'am',
            'start',
            '-n',
            'com.aasc.display/.MainActivity',
            '--es',
            'server_url',
            DEFAULT_SERVER_URL
        ]
    );
});

test('Samsung DeX 启动 APK 时使用全屏窗口', () => {
    const manifest = fs.readFileSync(MANIFEST, 'utf8');

    assert.match(manifest, /com\.samsung\.android\.dex\.launchwidth/);
    assert.match(manifest, /com\.samsung\.android\.dex\.launchheight/);
    assert.match(manifest, /launchwidth[\s\S]*android:value="0"/);
    assert.match(manifest, /launchheight[\s\S]*android:value="0"/);
});
