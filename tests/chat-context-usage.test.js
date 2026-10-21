const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// 隔离配置、历史和续接状态；验证不会触及真实账号或运行服务器。
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-context-usage-'));
const paths = require.resolve('../src/apps/server/modules/config/user-config-paths');
require.cache[paths] = { id: paths, filename: paths, loaded: true, exports: { USER_CONFIG_DIR: directory } };
const chat = require('../src/external/llm/llm-service');
const { createChatContextUsageService, resolveChatContextOptions } =
    require('../src/apps/server/modules/chat/chat-context-usage');
test.after(async () => { await chat.shutdown(); fs.rmSync(directory, { recursive: true, force: true }); });

for (const format of ['raw', 'openai']) {
    test(`${format}统计与真实发送的裁剪后输入一致，查询不请求模型`, async () => {
        const requests = [];
        const server = http.createServer(async (incoming, response) => {
            let body = '';
            for await (const chunk of incoming) body += chunk;
            requests.push(JSON.parse(body));
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.end('data: {"choices":[{"delta":{"content":"回答"}}]}\n\ndata: [DONE]\n\n');
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            chat.init({ llmProfiles: [{ name: 'usage', model: 'test', mode: 'llm', protocol: 'openai-completions',
                apiUrl: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, maxTokens: 60 }],
                activeProfile: 'usage', maxTokens: 60, promptFormat: format, systemPrompt: '系统' });
            chat.setConfig({ maxTokens: 60, promptFormat: format, systemPrompt: '系统' });
            const historyMessages = Array.from({ length: 10 }, (_, index) => ({
                role: index % 2 ? 'assistant' : 'user', content: `历史${index}abcdefg`
            }));
            const options = { mode: 'private', target: '测试', sessionId: format, contextCount: 4,
                includeHistory: true, historyMessages };
            const reports = [];
            const result = await chat.chatStream('本次问题', { ...options, onContextUsage: usage => reports.push(usage) }, {});
            assert.equal(result.success, true);
            assert.equal(requests.length, 1);
            assert.equal(reports.length, 1);
            const usage = reports[0];
            const messages = requests[0].messages;
            const historyText = messages.map(message => message.content).join('\n');
            const sentHistoryCount = (historyText.match(/历史\dabcdefg/g) || []).length;
            assert.equal(usage.historyLimit, 4);
            assert.equal(usage.historyCount, sentHistoryCount);
            assert.ok(usage.historyCount < 4, '应同时经过条数上限和token预算裁剪');
            const estimated = format === 'raw' ? Math.ceil(messages[0].content.length / 2)
                // 沿用原组装器为系统提示和新输入预留的额外开销，不改预算算法。
                : messages.reduce((total, message) => total + Math.ceil(message.content.length / 2) + 10, 30);
            assert.equal(usage.inputTokens, estimated);
            assert.equal(usage.percent, Math.round(estimated * 100 / 60));
            assert.equal(usage.estimated, true);
            assert.deepEqual(chat.getContextUsage('本次问题', options), usage);
            assert.equal(requests.length, 1, '统计查询必须只组装消息，不额外调用模型');
        } finally { await new Promise(resolve => server.close(resolve)); }
    });
}

test('关闭历史、长固定提示和旧成对记录沿用聊天管理口径', () => {
    chat.setConfig({ maxTokens: 1000, promptFormat: 'raw', systemPrompt: '系统' });
    const legacy = [{ user: '旧用户', assistant: '旧回答' }];
    assert.equal(chat.getContextUsage('', { includeHistory: true, contextCount: 100, historyMessages: legacy }).historyCount, 1);
    const disabled = chat.getContextUsage('', { includeHistory: false, contextCount: 100, historyMessages: legacy });
    assert.equal(disabled.historyCount, 0);
    assert.equal(disabled.historyLimit, 0);
    const overflow = chat.getContextUsage('长'.repeat(3000), { includeHistory: true, contextCount: 100, historyMessages: legacy });
    assert.equal(overflow.historyCount, 0);
    assert.ok(overflow.percent > 100, '固定输入超预算时不伪装为100%');
});

test('Responses续接仍按本地聊天管理统计，不按线上增量消息数计算', async () => {
    const requests = [];
    const server = http.createServer(async (incoming, response) => {
        let body = '';
        for await (const chunk of incoming) body += chunk;
        requests.push(JSON.parse(body));
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end('data: {"type":"response.output_text.delta","delta":"回答"}\n\n'
            + `data: ${JSON.stringify({ type: 'response.completed', response: { id: `response-${requests.length}` } })}\n\n`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        chat.init({ llmProfiles: [{ name: 'responses-usage', model: 'test', mode: 'llm', protocol: 'openai-responses',
            apiUrl: `http://127.0.0.1:${server.address().port}/v1`, maxTokens: 1000 }], activeProfile: 'responses-usage' });
        chat.setConfig({ maxTokens: 1000, promptFormat: 'openai', systemPrompt: '系统' });
        const options = { mode: 'private', target: '测试', sessionId: 'continuation', includeHistory: true, contextCount: 100,
            historyMessages: [{ role: 'user', content: '前问' }, { role: 'assistant', content: '前答' }] };
        const reports = [];
        for (const text of ['第一轮', '第二轮']) {
            const result = await chat.chatStream(text, { ...options, onContextUsage: value => reports.push(value) }, {});
            assert.equal(result.success, true);
        }
        assert.equal(requests[1].previous_response_id, 'response-1');
        assert.equal(requests[1].input.length, 1);
        assert.equal(reports[1].historyCount, 2);
        assert.equal(reports[1].historyLimit, 100);
        assert.deepEqual(reports[1], chat.getContextUsage('第二轮', options));
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('统计服务与实际聊天选项共用私聊100和全局配置，清空及切换会话不串数', () => {
    chat.setConfig({ maxTokens: 1000, promptFormat: 'openai', contextCount: 7 });
    chat.setTemplates([{ id: '小爱', name: '小爱', content: '角色设定' }]);
    assert.equal(resolveChatContextOptions(chat, { mode: 'private', templateTarget: '小爱' }).contextCount, 100);
    assert.equal(resolveChatContextOptions(chat, { mode: 'group' }).contextCount, 7);
    chat.addMessage({ mode: 'private', target: '小爱', templateId: '小爱', sessionId: 'one', role: 'user', content: '问题' });
    chat.addMessage({ mode: 'private', target: '小爱', templateId: '小爱', sessionId: 'one', role: 'assistant', content: '回答' });
    const service = createChatContextUsageService({ chat });
    const scope = { mode: 'private', target: '小爱', sessionId: 'one' };
    const first = service.snapshot(scope);
    assert.equal(first.usage.historyCount, 2);
    assert.equal(first.usage.historyLimit, 100);
    assert.equal(service.snapshot({ ...scope, sessionId: 'two' }).usage.historyCount, 0);
    chat.clearHistory(scope);
    assert.equal(service.snapshot(scope).usage.historyCount, 0);
    assert.equal(service.snapshot(scope).usage.historyLimit, 100);
    assert.equal(service.snapshot({ mode: 'role', target: '独立Agent' }).usage, null);
});

test('WS统计回传请求编号和范围，游戏提示计入预算且不回传正文', () => {
    const service = createChatContextUsageService({ chat });
    const messages = [];
    const ws = { send: value => messages.push(JSON.parse(value)) };
    const scope = { mode: 'private', target: '小爱', sessionId: 'two' };
    assert.equal(service.handle(ws, { type: 'getChatContextUsage', requestId: 'query', ...scope }, 'display'), true);
    const result = messages[0];
    assert.equal(result.requestId, 'query');
    assert.deepEqual(result.scope, scope);
    assert.ok(result.usage.inputTokens > service.snapshot(scope).usage.inputTokens);
    assert.equal(Object.hasOwn(result.usage, 'systemPrompt'), false);
    assert.equal(service.handle(ws, { type: 'unrelated' }), false);
});
