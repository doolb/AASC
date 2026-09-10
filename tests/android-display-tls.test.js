'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(
    PROJECT_ROOT,
    'src/apps/android-display/app/src/main/AndroidManifest.xml'
);
const NETWORK_CONFIG_PATH = path.join(
    PROJECT_ROOT,
    'src/apps/android-display/app/src/main/res/xml/network_security_config.xml'
);
const APK_CERT_PATH = path.join(
    PROJECT_ROOT,
    'src/apps/android-display/app/src/main/res/raw/aasc_server_cert.pem'
);
const SERVER_CERT_PATH = path.join(PROJECT_ROOT, 'res/certs/cert.pem');
const MAIN_ACTIVITY_PATH = path.join(
    PROJECT_ROOT,
    'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'
);
const BUILD_GRADLE_PATH = path.join(
    PROJECT_ROOT,
    'src/apps/android-display/app/build.gradle.kts'
);

function readText(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function readCertificateExtensions(certificatePath) {
    return execFileSync(
        'openssl',
        ['x509', '-in', certificatePath, '-noout', '-ext', 'subjectAltName'],
        { encoding: 'utf8' }
    );
}

test('Android 应用引用统一的 Network Security Config', () => {
    const manifest = readText(MANIFEST_PATH);

    assert.match(
        manifest,
        /android:networkSecurityConfig="@xml\/network_security_config"/u
    );
});

test('Android 构建显式解压 native Node 库供 ProcessBuilder 执行', () => {
    const buildGradle = readText(BUILD_GRADLE_PATH);

    assert.match(buildGradle, /jniLibs\s*\{[\s\S]*useLegacyPackaging\s*=\s*true/u);
});

test('Network Security Config 同时保留系统用户证书并绑定主服务器证书', () => {
    const config = readText(NETWORK_CONFIG_PATH);

    assert.match(config, /<certificates src="system"\s*\/>/u);
    assert.match(config, /<certificates src="user"\s*\/>/u);
    assert.match(config, /<certificates src="@raw\/aasc_server_cert"\s*\/>/u);
});

test('APK 证书资源与主服务器证书保持一致', () => {
    assert.equal(readText(APK_CERT_PATH), readText(SERVER_CERT_PATH));
});

test('主服务器开发证书包含当前局域网访问地址的 SAN', () => {
    const extensions = readCertificateExtensions(SERVER_CERT_PATH);

    assert.match(extensions, /IP Address:192\.168\.1\.39/u);
    assert.match(extensions, /DNS:localhost/u);
    assert.match(extensions, /IP Address:127\.0\.0\.1/u);
});

test('WebView SSL 错误默认取消，不放行未知自签名证书', () => {
    const mainActivity = readText(MAIN_ACTIVITY_PATH);

    assert.match(mainActivity, /handler\.cancel\(\)/u);
    assert.doesNotMatch(mainActivity, /handler\.proceed\(\)/u);
});
