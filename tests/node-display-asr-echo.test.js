'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const nodeMain = read('src/apps/voice-display-node/main.js');
const asrClient = read('src/apps/voice-display-node/asr-client.js');

const { formatAsrDisplayText } = require('../src/apps/voice-display-node/asr-display');

test('子显示端按网页显示端规则回显声纹分段和 ignoredText', () => {
    const displayText = formatAsrDisplayText({
        status: 'success',
        segments: [
            { text: '你好', speaker: '小明' },
            {
                text: '开灯',
                speaker: null,
                similarityScores: [0.1234, 0.4567],
                threshold: 0.3
            }
        ],
        ignoredText: '嗯'
    });

    assert.equal(
        displayText,
        '[小明] 你好\n[未识别声纹｜相似度 0.123/0.457｜阈值 0.300] 开灯\n[未识别有效内容] 嗯'
    );
});

test('ignored 响应保留服务器返回的识别文本', () => {
    assert.match(asrClient, /case\s+'ignored'[\s\S]*text:\s*result\.text\s*\|\|\s*''/, 'ASR 客户端应保留 ignored.text');
    assert.doesNotMatch(
        asrClient,
        /case\s+'ignored'[\s\S]*text:\s*''\s*,\s*status:\s*'ignored'/,
        'ASR 客户端不能把 ignored.text 强制清空'
    );
});

test('ASR 响应只更新本地回显，不通过 voiceInput 二次发送', () => {
    const start = nodeMain.indexOf('const onAudioData = async');
    const end = nodeMain.indexOf('\n        };', start);
    assert.ok(start >= 0 && end > start, '应找到 ASR 音频回调');
    const callback = nodeMain.slice(start, end);
    assert.doesNotMatch(callback, /this\.sendVoiceInput\s*\(/, 'ASR 回调不应二次发送 voiceInput');
    assert.match(callback, /formatAsrDisplayText/, 'ASR 回调应使用统一回显格式');
});

test('回显不改写工作角色名或其他原始识别文本', () => {
    const text = '工作角色 小爱请打开客厅灯';
    assert.equal(formatAsrDisplayText({ status: 'success', text }), text);
    assert.equal(formatAsrDisplayText({ status: 'ignored', text }), text);
});

console.log('node-display-asr-echo.test.js: contract checks passed');
