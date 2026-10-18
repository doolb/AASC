const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_TTS_SEGMENT_CHARS, isPunctuationOnly, splitIntoSentences } = require('../src/core/utils/sentence-splitter');

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
        ['喵呜……', '？', '（耳朵瞬间变得通红']
    );
});

test('长句有界分段，保留中文、英文和 emoji 的原有顺序', () => {
    const source = `天气${'晴'.repeat(125)}，${'cloudy'.repeat(30)}🙂${'雨'.repeat(140)}。`;
    const sentences = splitIntoSentences(source);
    assert.ok(sentences.length > 3);
    assert.ok(sentences.every(sentence => Array.from(sentence).length <= MAX_TTS_SEGMENT_CHARS));
    assert.equal(sentences.join(''), source);
});

test('略超上限的长句不会留下单字尾段', () => {
    const sentences = splitIntoSentences('天'.repeat(MAX_TTS_SEGMENT_CHARS + 1));
    assert.equal(sentences.length, 2);
    assert.ok(sentences.every(sentence => Array.from(sentence).length > 20));
    assert.equal(sentences.join(''), '天'.repeat(MAX_TTS_SEGMENT_CHARS + 1));
});
