'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
const start = source.indexOf('const IGNORED_PATTERNS = [');
const end = source.indexOf('function normalizeAsrText(', start);
assert.ok(start >= 0 && end > start, '应能定位服务端 ASR 内容过滤入口');

function createFilter(requireChinese) {
    const logs = [];
    const hasValidContent = vm.runInNewContext(`${source.slice(start, end)}; hasValidContent`, {
        config: { get: (key, fallback) => key === 'asr.requireChinese' ? requireChinese : fallback },
        log: (scope, message) => logs.push({ scope, message })
    });
    return { hasValidContent, logs };
}

test('要求中文时保留短字母数字语音代码，句末标点不改变判断', () => {
    const { hasValidContent, logs } = createFilter(true);
    for (const input of ['C3。', 'C3', 'c3?', '3C！', 'A1B2。']) {
        assert.equal(hasValidContent(input), true, input);
    }
    assert.equal(logs.length, 0);
});

test('紧凑字母与中文数字编号原样通过，普通短中文继续过滤', () => {
    const { hasValidContent } = createFilter(true);
    for (const input of ['A一。', 'H八。', 'H8。', 'B十二。']) {
        assert.equal(hasValidContent(input), true, input);
    }
    for (const input of ['A中。', '一。', 'A 一。', 'A-一。']) {
        assert.equal(hasValidContent(input), false, input);
    }
});

test('普通噪声和非连续代码仍沿用原过滤规则', () => {
    const { hasValidContent } = createFilter(true);
    for (const input of ['ABC。', '3。', 'C 3。', 'C-3。', 'C3中', 'C3 C4', 'A123456789012', '。']) {
        assert.equal(hasValidContent(input), false, input);
    }
    assert.equal(hasValidContent('你好'), true);
});

test('关闭中文要求后，短代码通过且既有英文短噪声继续过滤', () => {
    const { hasValidContent } = createFilter(false);
    assert.equal(hasValidContent('C3。'), true);
    assert.equal(hasValidContent('hi'), false);
    assert.equal(hasValidContent('ABC。'), false);
});

test('连续语音识别结果 C3。与 A一。原样进入显示端入口', () => {
    const { hasValidContent } = createFilter(true);
    const routeStart = source.indexOf('function processRecognizedAsrResultForDisplay(');
    const routeEnd = source.indexOf("app.post('/api/asr/recognize'", routeStart);
    assert.ok(routeStart >= 0 && routeEnd > routeStart);
    const submitted = [];
    const processRecognizedAsrResultForDisplay = vm.runInNewContext(
        `${source.slice(routeStart, routeEnd)}; processRecognizedAsrResultForDisplay`, {
            globalRecordingPaused: false,
            displayClients: new Map([['display-a', { state: { voiceContinuousEnabled: true } }]]),
            normalizeAsrSegments: () => [],
            normalizeAsrText: text => String(text || '').trim(),
            hasValidContent,
            getAsrSegmentTiming: () => ({}),
            processDisplayVoiceInput: (displayId, data) => submitted.push({ displayId, ...data })
        });
    processRecognizedAsrResultForDisplay('display-a', { text: 'C3。' }, {});
    processRecognizedAsrResultForDisplay('display-a', { text: 'A一。' }, {});
    assert.equal(submitted.length, 2);
    assert.equal(submitted[0].displayId, 'display-a');
    assert.equal(submitted[0].text, 'C3。');
    assert.equal(submitted[1].text, 'A一。');
});
