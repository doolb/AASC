const test = require('node:test');
const assert = require('node:assert/strict');
const { isPunctuationOnly, splitIntoSentences } = require('../src/core/utils/sentence-splitter');

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

test('splitIntoSentences avoids decimal points and flushes after four commas', () => {
    assert.deepEqual(
        splitIntoSentences('版本 1.2 可用，第一项，第二项，第三项，第四项，后续。'),
        ['版本 1.2 可用，第一项，第二项，第三项，第四项，', '后续。']
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
