'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toSpeechText, createMarkdownSentenceStream } = require('../src/core/utils/markdown-speech');

test('Markdown朗读保留正文、列表与链接文字，排除地址和代码围栏', () => {
    assert.equal(toSpeechText('# 标题\n- **第一项**\n> _引用_ [文档](https://example.com/a(b))\n![说明](https://example.com/a.png)\n```js\n不能朗读();\n```\n行内 `hello_world`。'),
        '标题\n第一项\n引用 文档\n说明\n行内 hello_world。');
    assert.equal(toSpeechText('| 名称 | 数量 |\n| --- | ---: |\n| 苹果 | 2 |'), '名称 数量\n苹果 2');
});

test('加粗跨块仍能提前分句，字幕保留格式且末句不会重复', () => {
    const stream = createMarkdownSentenceStream();
    const first = stream.push('**第一句。');
    assert.equal(first[0].text, '第一句。');
    assert.equal(first[0].subtitle.markdown, '**第一句。**');
    assert.deepEqual(stream.push('第二'), []);
    const next = stream.push('句**。尾巴');
    assert.equal(next[0].text, '第二句。');
    assert.equal(next[0].subtitle.offset, 4);
    assert.deepEqual(stream.finish().map(s => s.text), ['尾巴']);
    assert.deepEqual(stream.finish(), []);
});

test('未收齐链接/行内代码和代码围栏不会漏读标记或URL', () => {
    const stream = createMarkdownSentenceStream();
    assert.deepEqual(stream.push('[文档]('), []);
    assert.deepEqual(stream.push('https://example.com/a。'), []);
    assert.deepEqual(stream.push(')可用。\n```js\n错误。\n'), [{ text: '文档可用。', subtitle: {
        markdown: '[文档](https://example.com/a。)可用。\n```js\n错误。\n', speech: '文档可用。', offset: 0 } }]);
    assert.deepEqual(stream.push('```\n`hello'), []);
    assert.equal(stream.push('_world`完成。')[0].text, 'hello_world完成。');
});

test('完整标题/列表行在换行到齐时立即分句，不等下一段正文或代码围栏结束', () => {
    const stream = createMarkdownSentenceStream();
    assert.deepEqual(stream.push('# 标题\n```js\n代码。').map(s => s.text), ['标题']);
    assert.deepEqual(stream.push('\n```\n- 列表项\n').map(s => s.text), ['列表项']);
    assert.deepEqual(stream.finish(), []);
});

test('正文中的数字乘号和标识符不是Markdown格式，不得丢字符', () => {
    assert.equal(toSpeechText('计算 2*3=6，变量 hello_world。'), '计算 2*3=6，变量 hello_world。');
});
