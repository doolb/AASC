'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const scriptsDir = path.join(root, 'scripts', 'api-sh');
const userScripts = [
    'api-request.sh',
    'health.sh',
    'media-list.sh',
    'play.sh',
    'tts-generate.sh',
    'asr-recognize.sh',
    'vision-ocr.sh',
    'vision-yolo.sh',
    'run-all.sh'
];

test('API 命令行工具包含公共调用器和常用业务脚本', () => {
    assert.equal(fs.existsSync(path.join(scriptsDir, 'common.sh')), true);
    for (const filename of userScripts) {
        const filePath = path.join(scriptsDir, filename);
        assert.equal(fs.existsSync(filePath), true, `缺少脚本 ${filename}`);
        const source = fs.readFileSync(filePath, 'utf8');
        assert.match(source, /^#!\/usr\/bin\/env bash/m);
        assert.match(source, /set -euo pipefail/);
        assert.match(source, /common\.sh/);
        assert.match(source, /--help/);
    }
});

test('API 命令行工具暴露用户操作和 AI 机器输出契约', () => {
    const read = (filename) => fs.readFileSync(path.join(scriptsDir, filename), 'utf8');
    assert.match(read('common.sh'), /--noproxy/);
    assert.match(read('play.sh'), /\/upload-file/);
    assert.match(read('tts-generate.sh'), /\/api\/tts\/generate/);
    assert.match(read('asr-recognize.sh'), /\/api\/asr\/recognize/);
    assert.match(read('vision-ocr.sh'), /\/api\/vision\/ocr/);
    assert.match(read('vision-yolo.sh'), /\/api\/vision\/yolo/);
    assert.match(read('api-request.sh'), /--json/);
    assert.match(read('api-request.sh'), /--file/);
    assert.match(read('api-request.sh'), /confirm/i);
    assert.match(read('run-all.sh'), /api\/status/);
});

test('项目提供 API 文档和 api:test 入口', () => {
    const documentation = fs.readFileSync(path.join(root, 'docs', 'api-usage.md'), 'utf8');
    const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.match(documentation, /AASC_URL/);
    assert.match(documentation, /play\.sh/);
    assert.match(documentation, /tts-generate\.sh/);
    assert.match(documentation, /asr-recognize\.sh/);
    assert.match(documentation, /JSON/);
    assert.equal(packageData.scripts['api:test'], 'bash scripts/api-sh/run-all.sh');
});
