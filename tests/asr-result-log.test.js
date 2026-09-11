'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const { formatAsrResultLog } = require(
    '../src/apps/server/modules/asr/asr-result-log-formatter'
);

test('ASR 详细日志包含总文字和每段声纹诊断信息', () => {
    const message = formatAsrResultLog({
        requestId: 'req-1',
        text: '你好呀。',
        speaker: 'z',
        similarityScore: 0.82,
        threshold: 0.3,
        segments: [{
            text: '你好呀。',
            start: 0.2,
            end: 1.4,
            clusterId: 1,
            speaker: 'z',
            similarityScore: 0.82,
            threshold: 0.3,
            error: null
        }]
    }, true);

    assert.match(message, /"text":"你好呀。"/u);
    assert.match(message, /"speaker":"z"/u);
    assert.match(message, /"similarityScore":0\.82/u);
    assert.match(message, /"threshold":0\.3/u);
    assert.match(message, /"clusterId":1/u);
    assert.match(message, /"start":0\.2/u);
    assert.match(message, /"end":1\.4/u);
});

test('ASR 简要日志保留文字但不打印分段明细', () => {
    const message = formatAsrResultLog({
        requestId: 'req-2',
        text: '未识别语音',
        speaker: null,
        similarityScore: 0.12,
        threshold: 0.3,
        segments: [{ text: '未识别语音', speaker: null, similarityScore: 0.12 }]
    }, false);

    assert.match(message, /"text":"未识别语音"/u);
    assert.match(message, /"speaker":null/u);
    assert.doesNotMatch(message, /"segments"/u);
});

test('ASR 缺少或显式为空的声纹数值记录为 null', () => {
    const message = formatAsrResultLog({
        requestId: 'req-3',
        text: '普通语音',
        similarityScore: null,
        threshold: null
    }, true);

    assert.match(message, /"similarityScore":null/u);
    assert.match(message, /"threshold":null/u);
});

test('控制端提供默认开启的 ASR/声纹详细日志开关并接入配置', () => {
    const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
    const panel = read('src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js');
    const server = read('src/apps/server/boot/server-app.js');
    const config = read('src/apps/server/modules/config/config-app-service.js');

    assert.match(upload, /id="vpAsrResultDetailLogCheck"/u);
    assert.match(upload, /打印 ASR\/声纹详细日志/u);
    assert.match(panel, /vpAsrResultDetailLogCheck/u);
    assert.match(panel, /asrResultDetailLog !== false/u);
    assert.match(panel, /asrResultDetailLog:/u);
    assert.match(server, /voiceprint\.asrResultDetailLog/u);
    assert.match(server, /formatAsrResultLog\(\s*data,/u);
    assert.match(server, /log\('WS',\s*logMessage/u);
    assert.match(config, /asrResultDetailLog:\s*true/u);
});

console.log('asr-result-log.test.js: passed');
