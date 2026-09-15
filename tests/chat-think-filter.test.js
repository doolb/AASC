'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const llmService = require('../src/external/llm/llm-service');
const originalConfig = llmService.getConfig();
const originalSession = llmService.getSession();

const requireThinkFilterApi = () => {
    assert.equal(typeof llmService.stripThinkBlocks, 'function', '聊天服务应导出 think 清洗函数');
    assert.equal(typeof llmService.createThinkOutputFilter, 'function', '聊天服务应导出流式 think 过滤器');
    return {
        createThinkOutputFilter: llmService.createThinkOutputFilter,
        stripThinkBlocks: llmService.stripThinkBlocks
    };
};

test('stripThinkBlocks 移除成对和未闭合的 think 内容', () => {
    const { stripThinkBlocks } = requireThinkFilterApi();
    assert.equal(stripThinkBlocks('<think>内部推理</think>正常回答'), '正常回答');
    assert.equal(stripThinkBlocks('前缀<thinking>内部推理</thinking>正文'), '前缀正文');
    assert.equal(stripThinkBlocks('<think>只有内部推理'), '');
});

test('stripThinkBlocks 处理孤立结束标签前的角色配置泄漏', () => {
    const { stripThinkBlocks } = requireThinkFilterApi();
    const leaked = [
        '<character_set>我是小爱</character_set>',
        '<role_settings>{"description":"角色设定"}</role_settings>',
        '</markdown_document>',
        '</think>',
        '喵呜～ 来啦？'
    ].join('\n');

    assert.equal(stripThinkBlocks(leaked), '喵呜～ 来啦？');
});

test('ThinkOutputFilter 支持跨 chunk 标签并只回调可见正文', () => {
    const { createThinkOutputFilter } = requireThinkFilterApi();
    const filter = createThinkOutputFilter();
    const visible = [];
    const chunks = [
        '<th',
        'ink>内部推理',
        '</thi',
        'nk>正文第一句。',
        '正文第二句！'
    ];

    for (const chunk of chunks) {
        const result = filter.push(chunk);
        if (result.delta) visible.push(result.delta);
    }
    const finished = filter.finish();
    if (finished.delta) visible.push(finished.delta);

    assert.deepEqual(visible, ['正文第一句。', '正文第二句！']);
    assert.equal(finished.message, '正文第一句。正文第二句！');
});

test('ThinkOutputFilter 暂存结构化隐式思考前缀并在结束后释放正文', () => {
    const { createThinkOutputFilter } = requireThinkFilterApi();
    const filter = createThinkOutputFilter();
    const first = filter.push('<character_set>我是小爱</character_set>');
    const second = filter.push('</markdown_document>\n</think>\n');
    const third = filter.push('喵呜～ 来啦？');
    const finished = filter.finish();

    assert.equal(first.delta, '');
    assert.equal(second.delta, '');
    assert.equal(third.delta, '喵呜～ 来啦？');
    assert.equal(finished.message, '喵呜～ 来啦？');
});

test('chatStream Responses 实际只向回调发送清洗后的正文', async () => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('data: {"type":"response.output_text.delta","delta":"<character_set>内部"}\n\n');
        response.write('data: {"type":"response.output_text.delta","delta":"</think>喵呜～"}\n\n');
        response.write('data: [DONE]\n\n');
        response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
        llmService.init({
            activeProfile: 'think-test',
            llmProfiles: [{
                name: 'think-test',
                mode: 'llm',
                protocol: 'openai-responses',
                apiUrl: `http://127.0.0.1:${server.address().port}/v1/chat/completions`,
                model: 'test-model',
                maxTokens: 100,
                temperature: 0.1
            }]
        });
        const chunks = [];
        const result = await llmService.chatStream('喂喂喂', {}, {
            onChunk: (_delta, message) => chunks.push(message),
            onComplete: (message) => chunks.push(`complete:${message}`)
        });

        assert.equal(result.success, true);
        assert.equal(result.message, '喵呜～');
        assert.deepEqual(chunks, ['喵呜～', 'complete:喵呜～']);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        llmService.init(originalConfig);
        llmService.setSession(originalSession, { source: 'testRestore', persist: false });
    }
});

test('chatStream Chat Completions 也只向回调发送清洗后的正文', async () => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('data: {"choices":[{"delta":{"content":"<think>内部</think>"}}]}\n\n');
        response.write('data: {"choices":[{"delta":{"content":"正文"}}]}\n\n');
        response.write('data: [DONE]\n\n');
        response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
        llmService.init({
            activeProfile: 'completions-think-test',
            llmProfiles: [{
                name: 'completions-think-test',
                mode: 'llm',
                protocol: 'openai-completions',
                apiUrl: `http://127.0.0.1:${server.address().port}/v1/chat/completions`,
                model: 'test-model',
                maxTokens: 100,
                temperature: 0.1
            }]
        });
        const result = await llmService.chatStream('喂喂喂', {}, {});
        assert.equal(result.success, true);
        assert.equal(result.message, '正文');
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        llmService.init(originalConfig);
        llmService.setSession(originalSession, { source: 'testRestore', persist: false });
    }
});
