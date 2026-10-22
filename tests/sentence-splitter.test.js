const test = require('node:test');
const assert = require('node:assert/strict');
const { createSentenceStream, isPunctuationOnly, splitIntoSentences } = require('../src/core/utils/sentence-splitter');

test('isPunctuationOnly identifies standalone punctuation without treating text as punctuation', () => {
    assert.equal(isPunctuationOnly('？！……'), true);
    assert.equal(isPunctuationOnly(' （ '), true);
    assert.equal(isPunctuationOnly('喵呜……'), false);
    assert.equal(isPunctuationOnly(''), false);
});

test('splitIntoSentences keeps Chinese and English sentence boundaries', () => {
    assert.deepEqual(
        splitIntoSentences('第一句。第二句! Third sentence. Next sentence.'),
        ['第一句。', '第二句!', 'Third sentence.', 'Next sentence.']
    );
});

test('splitIntoSentences avoids decimal points and flushes at the fourth comma', () => {
    assert.deepEqual(
        splitIntoSentences('版本 1.2 可用，第一项，第二项，第三项，第四项，后续。'),
        ['版本 1.2 可用，第一项，第二项，第三项，', '第四项，后续。']
    );
});

test('splitIntoSentences treats an ellipsis run as a sentence boundary', () => {
    assert.deepEqual(
        splitIntoSentences('你好......世界'),
        ['你好......', '世界']
    );
    assert.deepEqual(
        splitIntoSentences('你好……世界'),
        ['你好……', '世界']
    );
});

test('splitIntoSentences drops later punctuation-only segments in a consecutive run', () => {
    assert.deepEqual(
        splitIntoSentences('喵呜……？！ （耳朵瞬间变得通红'),
        ['喵呜……', '？', '耳朵瞬间变得通红']
    );
});

test('全角括号在当前分句器形成边界，内部正文保留而括号字形不进入TTS', () => {
    assert.deepEqual(splitIntoSentences('喵呜（耳朵通红）真的吗？'), ['喵呜', '耳朵通红', '真的吗？']);
    assert.deepEqual(splitIntoSentences('（独立内容）'), ['独立内容']);
    assert.deepEqual(splitIntoSentences('（）'), []);
    assert.deepEqual(splitIntoSentences('喵呜( 轻轻蹭了蹭你的脸颊) 好吗？'), ['喵呜', '轻轻蹭了蹭你的脸颊', '好吗？']);
    assert.deepEqual(splitIntoSentences('(轻轻蹭了蹭你的脸颊)'), ['轻轻蹭了蹭你的脸颊']);
    assert.deepEqual(splitIntoSentences('()'), []);
});

test('长句仅按自然边界分段，不以120字截断并保留全部原文', () => {
    const source = `天气${'晴'.repeat(125)}，${'cloudy'.repeat(30)}🙂${'雨'.repeat(140)}。`;
    assert.deepEqual(splitIntoSentences(source), [source]);
    assert.deepEqual(splitIntoSentences('天'.repeat(121)), ['天'.repeat(121)]);
});

test('流式句末立即产出，跨块逗号计数、英文小数与尾段只冲刷一次', () => {
    const stream = createSentenceStream();
    assert.deepEqual(stream.push('第一句。'), ['第一句。']);
    assert.deepEqual(stream.push('版本1.'), []);
    assert.deepEqual(stream.push('2，甲，乙，丙，'), ['版本1.2，甲，乙，丙，']);
    assert.deepEqual(stream.push('尾段'), []);
    assert.deepEqual(stream.finish(), ['尾段']);
    assert.deepEqual(stream.finish(), []);
    assert.deepEqual(stream.push('迟到。'), []);
});
