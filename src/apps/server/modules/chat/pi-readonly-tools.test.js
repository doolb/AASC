'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    validateReadOnlyUrl,
    readOnlyFetch,
    parseSearchResults
} = require('./pi-readonly-tools');

const extensionFile = path.join(__dirname, 'pi-readonly-tools.mjs');
const findToolFile = path.join(__dirname, 'pi-find-tool.mjs');

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

test('扩展源码注册 Chat2API 兼容 Provider 流', () => {
    const source = fs.readFileSync(extensionFile, 'utf8');
    assert.match(source, /createChat2ApiCompatibleProvider/u);
    assert.match(source, /registerProvider\(createChat2ApiCompatibleProvider/u);
    assert.match(source, /AASC_PI_CONVERSATION_ID/u);
    assert.match(source, /previous_response_id/u);
    assert.match(source, /conversation/u);
    assert.match(source, /aasc_context_owner/u);
});

test('扩展源码注册不依赖 fd 的稳定文件查找工具', () => {
    const source = fs.readFileSync(extensionFile, 'utf8');
    const finderSource = fs.readFileSync(findToolFile, 'utf8');
    assert.match(source, /name:\s*'aasc_find'/u);
    assert.match(source, /findFiles/u);
    assert.match(finderSource, /readdir/u);
    assert.doesNotMatch(source, /ensureTool\(['"]fd['"]\)/u);
});

test('稳定文件查找工具可以在没有 fd 时查找 package.json', async () => {
    const finder = await import(pathToFileURL(findToolFile).href);
    const results = await finder.findFiles(
        '/mnt/AASC',
        'package.json',
        1000,
        new AbortController().signal
    );
    assert.ok(results.includes('package.json'));
});
