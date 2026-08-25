'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const SCRIPT_PATH = path.join(__dirname, '..', '3rd', 'tts-server', 'scripts', 'prepare-runtime.sh');

test('运行时准备脚本从官方地址下载 Linux/Wine SDK 并用 wineboot 生成 prefix', () => {
    assert.equal(fs.existsSync(SCRIPT_PATH), true, '运行时准备脚本必须存在');
    const source = fs.readFileSync(SCRIPT_PATH, 'utf8');

    assert.match(source, /https:\/\/aka\.ms\/csspeech\/linuxembeddedbinary/);
    assert.match(source, /https:\/\/www\.nuget\.org\/api\/v2\/package\/Microsoft\.CognitiveServices\.Speech\/\$\{WINE_SDK_VERSION\}/);
    assert.match(source, /Microsoft\.CognitiveServices\.Speech\.Extension\.Embedded\.TTS/);
    assert.match(source, /Microsoft\.CognitiveServices\.Speech\.Extension\.ONNX\.Runtime/);
    assert.match(source, /Microsoft\.CognitiveServices\.Speech\.Extension\.Telemetry/);
    assert.match(source, /wineboot --init/);
    assert.match(source, /runtimes\/win-x64\/native/);
    assert.match(source, /WINE_BIN_DIR/);
    assert.match(source, /SDK_ARCHIVE_DIR/);
    assert.match(source, /sdk-archives/);
    assert.match(source, /SpeechSDK-Embedded-Linux-\$\{LINUX_SDK_VERSION\}\.tar\.gz/);
    assert.doesNotMatch(source, /\.cache\/downloads/);
    assert.doesNotMatch(source, /git lfs/);
    assert.match(source, /if \[\[ "\$response_code" != '200' \]\]; then[\s\S]*?return 1/);
    assert.match(source, /if ! file "\$output" \| grep -q 'WAVE audio'; then[\s\S]*?return 1/);
    assert.match(source, /cp -f/);
    assert.doesNotMatch(source, /NaturalVoiceSAPIAdapter/);
});

test('运行时准备脚本 dry-run 输出准备、构建和双端测试计划', () => {
    const result = spawnSync('bash', [SCRIPT_PATH, '--dry-run'], {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        env: {
            ...process.env,
            SDK_ARCHIVE_DIR: '/tmp/aasc-test-sdk-archives',
            LINUX_SDK_DIR: '/tmp/aasc-test-linux-sdk-not-existing',
            WINE_SDK_DIR: '/tmp/aasc-test-wine-sdk-not-existing',
            WINE_PREFIX_DIR: '/tmp/aasc-test-wine-prefix-not-existing'
        }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\/tmp\/aasc-test-sdk-archives/);
    assert.match(result.stdout, /download-linux-sdk/);
    assert.match(result.stdout, /download-wine-sdk/);
    assert.match(result.stdout, /wineboot --init/);
    assert.match(result.stdout, /test-linux/);
    assert.match(result.stdout, /test-wine/);
});
