'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ChatMarkdown = require('../src/apps/web-mediacenter/ui/public/js/chat-markdown.js');

const root = path.resolve(__dirname, '..');
const chatFile = path.join(root, 'src/apps/web-mediacenter/ui/public/js/chat.js');
const uploadFile = path.join(root, 'src/apps/web-mediacenter/ui/public/upload.html');

test('Markdown 渲染器支持标题、列表、代码块和链接', () => {
    const html = ChatMarkdown.render([
        '# 标题',
        '',
        '- 第一项',
        '- 第二项',
        '',
        '```js',
        'const answer = 42;',
        '```',
        '',
        '[项目地址](https://example.com)'
    ].join('\n'));

    assert.match(html, /<h1>标题<\/h1>/u);
    assert.match(html, /<ul>[\s\S]*<li>第一项<\/li>[\s\S]*<li>第二项<\/li>[\s\S]*<\/ul>/u);
    assert.match(html, /<pre><code class="language-js">const answer = 42;<\/code><\/pre>/u);
    assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">项目地址<\/a>/u);
});

test('Markdown 渲染器会转义用户提供的原始 HTML', () => {
    const html = ChatMarkdown.render('<script>alert("xss")<\/script> **安全文本**');

    assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/u);
    assert.match(html, /<strong>安全文本<\/strong>/u);
    assert.doesNotMatch(html, /<script[\s>]/u);
});

test('Markdown 渲染器不会生成危险链接', () => {
    const html = ChatMarkdown.render('[危险链接](javascript:alert(1)) [安全链接](/help)');

    assert.doesNotMatch(html, /href="javascript:/iu);
    assert.match(html, /危险链接/u);
    assert.match(html, /<a href="\/help" target="_blank" rel="noopener noreferrer">安全链接<\/a>/u);
});

test('控制端历史消息和流式消息统一使用 Markdown 渲染器', () => {
    const chat = fs.readFileSync(chatFile, 'utf8');
    const upload = fs.readFileSync(uploadFile, 'utf8');
    const markdownScriptIndex = upload.indexOf('js/chat-markdown.js');
    const chatScriptIndex = upload.indexOf('js/chat.js');

    assert.match(chat, /ChatMarkdown\.render\(content\)/u, '历史消息应使用 Markdown 渲染器');
    assert.match(chat, /ChatMarkdown\.render\(data\.message\)/u, '流式消息应使用 Markdown 渲染器');
    assert.match(chat, /<input type="text" id="chatInput"/u, '输入框应继续保持纯文本输入');
    assert.ok(markdownScriptIndex >= 0, '页面应加载 Markdown 渲染器');
    assert.ok(markdownScriptIndex < chatScriptIndex, 'Markdown 渲染器必须先于 chat.js 加载');
});
