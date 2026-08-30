'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_CHAT2API_TOOLS,
    parseChat2ApiToolCalls,
    convertChat2ApiContent
} = require('./pi-chat2api-tool-converter');

const SAMPLE_READ = '<|CHAT2API|tool_calls><|CHAT2API|invoke name="read"><|parameter=path>\n/mnt/AASC/package.json\n</parameter>\n</function>';

test('解析 Chat2API read 调用并生成 Pi 工具参数', () => {
    const result = parseChat2ApiToolCalls(SAMPLE_READ, DEFAULT_CHAT2API_TOOLS);

    assert.deepStrictEqual(result, {
        calls: [{
            type: 'toolCall',
            id: 'chat2api-1',
            name: 'read',
            arguments: { path: '/mnt/AASC/package.json' }
        }],
        remainingText: ''
    });
});

test('Chat2API find 调用映射为不依赖 fd 的稳定工具', () => {
    const text = '<|CHAT2API|tool_calls><|CHAT2API|invoke name="find"><|parameter=pattern>package.json</parameter></function>';
    const result = parseChat2ApiToolCalls(text, ['aasc_find']);

    assert.deepStrictEqual(result.calls, [{
        type: 'toolCall',
        id: 'chat2api-1',
        name: 'aasc_find',
        arguments: { pattern: 'package.json' }
    }]);
});

test('解析 Chat2API 的命名参数 CDATA 格式并映射 find', () => {
    const text = '<|CHAT2API|tool_calls><|CHAT2API|invoke name="find"><|CHAT2API|parameter name="pattern"><![CDATA[package.json]]></|CHAT2API|parameter></|CHAT2API|invoke></|CHAT2API|tool_calls>';
    const result = parseChat2ApiToolCalls(text, ['aasc_find']);

    assert.deepStrictEqual(result.calls, [{
        type: 'toolCall',
        id: 'chat2api-1',
        name: 'aasc_find',
        arguments: { pattern: 'package.json' }
    }]);
});

test('支持多个调用、多个参数和 JSON 参数', () => {
    const text = [
        '先查询：',
        '<|CHAT2API|tool_calls>',
        '<|CHAT2API|invoke name="grep"><|parameter=pattern>CHAT2API</parameter><|parameter=path>/mnt/AASC</parameter></function>',
        '<|CHAT2API|invoke name="ls"><|parameter=path>/mnt/AASC</parameter><|parameter=depth>2</parameter></function>',
        '完成。'
    ].join('');
    const result = parseChat2ApiToolCalls(text, DEFAULT_CHAT2API_TOOLS);

    assert.deepStrictEqual(result.calls, [
        {
            type: 'toolCall',
            id: 'chat2api-1',
            name: 'grep',
            arguments: { pattern: 'CHAT2API', path: '/mnt/AASC' }
        },
        {
            type: 'toolCall',
            id: 'chat2api-2',
            name: 'ls',
            arguments: { path: '/mnt/AASC', depth: 2 }
        }
    ]);
    assert.equal(result.remainingText, '先查询：完成。');
});

test('普通文本不被转换', () => {
    assert.deepStrictEqual(
        convertChat2ApiContent('这是普通回答。', DEFAULT_CHAT2API_TOOLS),
        { text: '这是普通回答。', calls: [] }
    );
});

test('未知工具不会执行', () => {
    assert.throws(
        () => parseChat2ApiToolCalls(
            '<|CHAT2API|tool_calls><|CHAT2API|invoke name="bash"><|parameter=command>id</parameter></function>',
            DEFAULT_CHAT2API_TOOLS
        ),
        /不允许的工具/u
    );
});

test('未闭合调用会报协议错误', () => {
    assert.throws(
        () => parseChat2ApiToolCalls(
            '<|CHAT2API|tool_calls><|CHAT2API|invoke name="read"><|parameter=path>/tmp/a',
            DEFAULT_CHAT2API_TOOLS
        ),
        /格式错误/u
    );
});

test('重复参数会报协议错误', () => {
    assert.throws(
        () => parseChat2ApiToolCalls(
            '<|CHAT2API|tool_calls><|CHAT2API|invoke name="read"><|parameter=path>/tmp/a</parameter><|parameter=path>/tmp/b</parameter></function>',
            DEFAULT_CHAT2API_TOOLS
        ),
        /重复参数/u
    );
});
