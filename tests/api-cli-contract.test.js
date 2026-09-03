'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const scriptsDir = path.join(root, 'scripts', 'api');
const userScripts = [
    'api-request.js',
    'health.js',
    'media-list.js',
    'play.js',
    'tts-generate.js',
    'asr-recognize.js',
    'vision-ocr.js',
    'vision-yolo.js',
    'chat-history.js',
    'run-all.js'
];

test('API 命令行工具包含跨平台 Node 公共调用器和业务脚本', () => {
    assert.equal(fs.existsSync(path.join(scriptsDir, 'common.js')), true);
    for (const filename of userScripts) {
        const filePath = path.join(scriptsDir, filename);
        assert.equal(fs.existsSync(filePath), true, `缺少脚本 ${filename}`);
        const source = fs.readFileSync(filePath, 'utf8');
        assert.match(source, /^#!\/usr\/bin\/env node/m);
        assert.match(source, /common/);
        assert.match(source, /--help/);
    }
    assert.equal(fs.existsSync(path.join(scriptsDir, 'vision-tui.js')), true);
    assert.equal(fs.existsSync(path.join(scriptsDir, 'chat-tui.js')), true);
    assert.equal(fs.existsSync(path.join(scriptsDir, 'vision-image.js')), true);
});

test('API 命令行工具暴露用户操作和 AI 机器输出契约', () => {
    const read = (filename) => fs.readFileSync(path.join(scriptsDir, filename), 'utf8');
    assert.match(read('common.js'), /rejectUnauthorized/);
    assert.match(read('play.js'), /\/upload-file/);
    assert.match(read('tts-generate.js'), /\/api\/tts\/generate/);
    assert.match(read('asr-recognize.js'), /\/api\/asr\/recognize/);
    assert.match(read('vision-ocr.js'), /\/api\/vision\/ocr/);
    assert.match(read('vision-yolo.js'), /\/api\/vision\/yolo/);
    assert.match(read('vision-ocr.js'), /--tui/);
    assert.match(read('vision-yolo.js'), /--tui/);
    assert.match(read('vision-ocr.js'), /--chafa/);
    assert.match(read('vision-yolo.js'), /--chafa/);
    assert.match(read('vision-ocr.js'), /vision-image/);
    assert.match(read('vision-yolo.js'), /vision-image/);
    assert.match(read('vision-ocr.js'), /vision-tui/);
    assert.match(read('vision-yolo.js'), /vision-tui/);
    assert.match(read('chat-history.js'), /\/api\/chat\/history/);
    assert.match(read('chat-history.js'), /\/api\/chat\/sessions/);
    assert.match(read('chat-history.js'), /--sessions/);
    assert.match(read('chat-history.js'), /toSessionNamesPayload/);
    assert.match(read('chat-history.js'), /--tui/);
    assert.match(read('api-request.js'), /--json/);
    assert.match(read('api-request.js'), /--file/);
    assert.match(read('api-request.js'), /confirm/i);
    assert.match(read('run-all.js'), /api\/status/);
});

test('项目提供 API 文档和 api:test 入口', () => {
    const documentation = fs.readFileSync(path.join(root, 'docs', 'api-usage.md'), 'utf8');
    const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.match(documentation, /AASC_URL/);
    assert.match(documentation, /play\.js/);
    assert.match(documentation, /tts-generate\.js/);
    assert.match(documentation, /asr-recognize\.js/);
    assert.match(documentation, /vision-tui\.js/);
    assert.match(documentation, /chat-history\.js/);
    assert.match(documentation, /--tui/);
    assert.match(documentation, /--chafa/);
    assert.match(documentation, /JSON/);
    assert.equal(packageData.scripts['api:test'], 'node scripts/api/run-all.js');
    assert.match(documentation, /scripts\/api\//);
});
