const assert = require('assert');
const fs = require('fs');

const serverJs = fs.readFileSync(
    'src/apps/server/boot/server-app.js',
    'utf8'
);
const displayHtml = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/display.html',
    'utf8'
);

assert.match(
    serverJs,
    /function processDisplayVoiceInput\(displayId, data, ws = null\)/,
    '服务端应提供统一的显示端 voiceInput 处理函数'
);
assert.match(
    serverJs,
    /processRecognizedAsrResultForDisplay\(sourceDisplayId,/,
    'ASR HTTP 入口应直接调用统一 voiceInput 处理函数'
);
assert.match(
    serverJs,
    /mergeVoiceprintSegments\(/,
    '服务端应合并 ASR 声纹分段'
);
assert.match(
    serverJs,
    /similarityScores/,
    '服务端应保留合并分段的相似度分数'
);

const recognitionStart = displayHtml.indexOf('async function sendAudioForRecognition');
const recognitionEnd = displayHtml.indexOf('// 只有服务器选中的 APK 提供端', recognitionStart);
const recognitionBody = displayHtml.slice(recognitionStart, recognitionEnd);
assert.match(recognitionBody, /formData\.append\(['"]displayId['"]/);
assert.match(recognitionBody, /formData\.append\(['"]speechStartAt['"]/);
assert.match(recognitionBody, /formData\.append\(['"]speechEndAt['"]/);
assert.doesNotMatch(
    recognitionBody,
    /sendRecognizedVoiceInput\(/,
    '新的显示端 ASR 流程不应再回传 voiceInput'
);
assert.match(
    displayHtml,
    /未识别声纹|similarityScore|threshold/,
    '显示端应回显未识别声纹的诊断信息'
);

const { mergeVoiceprintSegments } = require(
    '../src/apps/server/modules/voice/voiceprint-segment-grouper'
);

const grouped = mergeVoiceprintSegments([
    { text: '你好', speaker: 'z', similarityScore: 0.8, threshold: 0.3, start: 0, end: 1, clusterId: 1 },
    { text: '呀', speaker: 'z', similarityScore: 0.7, threshold: 0.3, start: 1, end: 2, clusterId: 2 },
    { text: '他好', speaker: 'x', similarityScore: 0.9, threshold: 0.3, start: 2, end: 3, clusterId: 3 },
    { text: '未知', speaker: null, similarityScore: 0.18, threshold: 0.3, start: 3, end: 4, clusterId: 4 },
    { text: '声音', speaker: null, similarityScore: 0.2, threshold: 0.3, start: 4, end: 5, clusterId: 5 }
]);

assert.deepStrictEqual(
    grouped.map(segment => ({ text: segment.text, speaker: segment.speaker })),
    [
        { text: '你好呀', speaker: 'z' },
        { text: '他好', speaker: 'x' },
        { text: '未知', speaker: null },
        { text: '声音', speaker: null }
    ]
);
assert.deepStrictEqual(grouped[0].similarityScores, [0.8, 0.7]);
assert.deepStrictEqual(grouped[0].clusterIds, [1, 2]);
assert.strictEqual(grouped[0].start, 0);
assert.strictEqual(grouped[0].end, 2);
assert.strictEqual(grouped[2].similarityScore, 0.18);

console.log('server-side-asr-processing.test.js: passed');
