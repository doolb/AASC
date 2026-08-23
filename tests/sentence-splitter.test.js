const test = require('node:test');
const assert = require('node:assert/strict');
const { splitIntoSentences } = require('../src/core/utils/sentence-splitter');

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
