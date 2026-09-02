'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const GRADLE_FILE = path.resolve(__dirname, '../../../../apps/android-display/app/build.gradle.kts');

test('正式 APK 不再创建视觉和降噪模型 assets', () => {
    const source = fs.readFileSync(GRADLE_FILE, 'utf8');
    assert.doesNotMatch(source, /prepareBundledDenoiseModel/);
    assert.doesNotMatch(source, /prepareBundledRapidOcrModels/);
    assert.doesNotMatch(source, /prepareBundledYolo11nModel/);
    assert.doesNotMatch(source, /generated\/assets\/vision/);
    assert.doesNotMatch(source, /generated\/assets\/speech-enhancement/);
});
