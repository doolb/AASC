'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    validateReadOnlyUrl,
    readOnlyFetch,
    parseSearchResults
} = require('./pi-readonly-tools');

const extensionFile = path.join(__dirname, 'pi-readonly-tools.mjs');

test('拒绝非 HTTP URL', () => {
    assert.throws(() => validateReadOnlyUrl('file:///etc/passwd'), /URL/);
});

test('网络工具只允许 GET 且限制响应大小', async () => {
    await assert.rejects(
        () => readOnlyFetch('https://example.test', { method: 'POST' }),
        /GET/
    );
});

test('搜索结果只返回标题、URL 和摘要', () => {
    const result = parseSearchResults(
        '<a class="result__a" href="https://example.test">标题</a>',
        3
    );
    assert.deepStrictEqual(result[0], {
        title: '标题', url: 'https://example.test', snippet: ''
    });
});

test('扩展源码不得启用写入或 shell 工具', () => {
    const source = fs.readFileSync(extensionFile, 'utf8');
    assert.doesNotMatch(source, /registerTool\(\{\s*name:\s*['"](?:bash|edit|write)['"]/u);
});
