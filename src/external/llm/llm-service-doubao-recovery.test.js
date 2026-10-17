const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-doubao-recovery-'));
const pathsModule = require.resolve('../../apps/server/modules/config/user-config-paths');
require.cache[pathsModule] = { id: pathsModule, filename: pathsModule, loaded: true, exports: { USER_CONFIG_DIR: configDir } };
const chat = require('./llm-service');

const completed = (id, conversationId, text) => ({
    id,
    conversation: { id: conversationId },
    model: 'doubao',
    output_text: text
});

const sendSse = (response, events) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end('data: [DONE]\n\n');
};

test('豆包位置不确定时恢复新上游会话，流式已输出时只清引用', async () => {
    const requests = [];
    const actions = [
        { body: completed('resp_a1', 'conv_a1', '第一轮回答') },
        { error: 'doubao_session_uncertain' },
        { body: completed('resp_a2', 'conv_a2', '第二轮回答') },
        { body: completed('resp_b1', 'conv_b1', '流式首轮回答') },
        { error: 'doubao_session_uncertain' },
        { events: [
            { type: 'response.output_text.delta', delta: '流式恢复成功' },
            { type: 'response.completed', response: completed('resp_b2', 'conv_b2', '流式恢复成功') }
        ] },
        { body: completed('resp_c1', 'conv_c1', '部分输出首轮') },
        { events: [
            { type: 'response.output_text.delta', delta: '部分正文' },
            { type: 'response.failed', error: { code: 'doubao_session_uncertain', message: '豆包上游会话位置已不确定，请新建会话' } }
        ] },
        { body: completed('resp_c2', 'conv_c2', '下一轮回答') },
        { error: 'doubao_session_uncertain' }
    ];
    const server = http.createServer(async (incoming, response) => {
        try {
            let raw = '';
            for await (const chunk of incoming) raw += chunk;
            requests.push(JSON.parse(raw));
            const action = actions.shift();
            if (!action) throw new Error('收到意外的额外请求');
            if (action.error) {
                response.writeHead(409, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ error: { code: action.error, message: '豆包上游会话位置已不确定，请新建会话' } }));
                return;
            }
            if (action.events) {
                sendSse(response, action.events);
                return;
            }
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(action.body));
        } catch (error) {
            response.writeHead(500);
            response.end(error.message);
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        chat.init({
            llmProfiles: [{
                name: 'doubao-recovery-test',
                mode: 'llm',
                protocol: 'openai-responses',
                apiUrl: `http://127.0.0.1:${server.address().port}/v1/chat/completions`,
                model: 'doubao',
                maxTokens: 1000,
                temperature: 0.7
            }],
            activeProfile: 'doubao-recovery-test'
        });

        const options = sessionId => ({ mode: 'private', target: '自动恢复测试', sessionId, includeHistory: true, contextCount: 6 });
        assert.equal((await chat.chat('第一轮', options('normal'))).success, true);
        const normal = await chat.chat('第二轮', options('normal'));
        assert.equal(normal.message, '第二轮回答');
        assert.equal(requests[1].previous_response_id, 'resp_a1');
        assert.equal(requests[2].previous_response_id, undefined);
        assert.deepEqual(requests[2].input.map(item => item.content), [
            '你是一个友好的助手，请用简洁的语言回答问题。', '第一轮', '第一轮回答', '第二轮'
        ]);

        assert.equal((await chat.chat('流式首轮', options('stream'))).success, true);
        const chunks = [];
        const streamed = await chat.chatStream('流式第二轮', options('stream'), { onChunk: chunk => chunks.push(chunk) });
        assert.equal(streamed.success, true);
        assert.equal(streamed.message, '流式恢复成功');
        assert.deepEqual(chunks, ['流式恢复成功']);
        assert.equal(requests[4].previous_response_id, 'resp_b1');
        assert.equal(requests[5].previous_response_id, undefined);

        assert.equal((await chat.chat('部分输出首轮', options('partial'))).success, true);
        const partialChunks = [];
        const partial = await chat.chatStream('部分输出第二轮', options('partial'), { onChunk: chunk => partialChunks.push(chunk) });
        assert.equal(partial.success, false);
        assert.deepEqual(partialChunks, ['部分正文']);
        assert.equal(requests.length, 8);
        const next = await chat.chat('部分输出后新一轮', options('partial'));
        assert.equal(next.success, true);
        assert.equal(requests[8].previous_response_id, undefined);
        const fresh = await chat.chat('全新会话失败', options('fresh'));
        assert.equal(fresh.success, false);
        assert.equal(requests.length, 10);
        assert.equal(actions.length, 0);
    } finally {
        await new Promise(resolve => server.close(resolve));
        chat.shutdown();
        fs.rmSync(configDir, { recursive: true, force: true });
    }
});
