const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const downloaderPath = path.join(ROOT, 'scripts', 'models', 'download-sensevoice-model.js');

test('SenseVoice 下载脚本固定官方 int8 来源和目标文件', () => {
    assert.equal(fs.existsSync(downloaderPath), true, 'SenseVoice 下载脚本不存在');
    const source = fs.readFileSync(downloaderPath, 'utf8');

    assert.match(
        source,
        /github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\/asr-models\/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17\.tar\.bz2/
    );
    assert.match(source, /res.*models.*sensevoice/);
    assert.match(source, /model\.int8\.onnx/);
    assert.match(source, /model\.int8\.onnx\.sha256/);
    assert.match(source, /--force/);
    assert.match(source, /rename/);
});
