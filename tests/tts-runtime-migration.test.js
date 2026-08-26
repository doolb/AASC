'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resolveLinuxRuntimeConfig } = require('../3rd/tts-server/tts-linux');

const HARD_CODED_LICENSE = 'Key:ZCjZ7nHDSLvf4gpELteM4AnzaWUjTpn7UkV7D@vvksl0w1SNgon6d1905WANbktDc9S39oaA4r29HJNayXvTq8fJsq';
const WINE_SERVER_PATH = path.join(__dirname, '..', '3rd', 'tts-server', 'tts-wine.js');
const APK_TTS_PATH = path.join(
    __dirname,
    '..',
    'src/apps/android-display/app/src/main/java/com/aasc/display/TtsEngine.kt'
);

test('Linux TTS 使用硬编码授权并忽略外部授权覆盖', () => {
    const config = resolveLinuxRuntimeConfig({
        TTS_LINUX_LICENSE: '错误授权',
        MS_TTS_KEY: '错误密钥'
    });

    assert.equal(config.license, HARD_CODED_LICENSE);
});

test('Wine TTS 使用独立 prefix 和硬编码授权', () => {
    const source = fs.readFileSync(WINE_SERVER_PATH, 'utf8');

    assert.match(source, /path\.join\(__dirname, 'wine', 'runtime', 'prefix'\)/);
    assert.doesNotMatch(source, /process\.env\.MS_TTS_KEY/);
    assert.match(source, new RegExp(HARD_CODED_LICENSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('APK TTS 使用同一硬编码授权', () => {
    const source = fs.readFileSync(APK_TTS_PATH, 'utf8');

    assert.match(source, new RegExp(HARD_CODED_LICENSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Wine prefix 已迁移到 tts-server runtime 目录', () => {
    const migratedPrefix = path.join(__dirname, '..', '3rd', 'tts-server', 'wine', 'runtime', 'prefix');

    assert.equal(fs.existsSync(path.join(migratedPrefix, 'user.reg')), true);
    assert.equal(fs.existsSync(path.join(migratedPrefix, 'system.reg')), true);
});
