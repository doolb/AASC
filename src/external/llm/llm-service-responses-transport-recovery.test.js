const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-responses-transport-'));
const pathsModule = require.resolve('../../apps/server/modules/config/user-config-paths');
require.cache[pathsModule] = { id: pathsModule, filename: pathsModule, loaded: true, exports: { USER_CONFIG_DIR: configDir } };
const chat = require('./llm-service');

const complete = (response, id, text) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`);
    response.write(`data: ${JSON.stringify({ type: 'response.completed', response: { id, conversation: { id: `conv_${id}` } } })}\n\n`);
    response.end('data: [DONE]\n\n');
};

test('临时会话建连中断时用完整历史重试一次；部分正文中断不重发并清除旧引用', async () => {
    const requests = [];
    const actions = ['drop', 'complete', 'partial', 'complete'];
    const server = http.createServer(async (incoming, response) => {
        let raw = '';
        for await (const chunk of incoming) raw += chunk;
        requests.push(JSON.parse(raw));
        const action = actions.shift();
        if (action === 'drop') { incoming.socket.destroy(); return; }
        if (action === 'partial') {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.write('data: {"type":"response.output_text.delta","delta":"部分正文"}\n\n');
            setTimeout(() => response.destroy(), 10);
            return;
        }
        if (action === 'complete') { complete(response, `resp_${requests.length}`, '恢复成功'); return; }
        response.writeHead(500); response.end('意外请求');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        chat.init({ llmProfiles: [{ name: 'transport-recovery-test', mode: 'llm', protocol: 'openai-responses',
            apiUrl: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, model: 'qwen', maxTokens: 1000 }],
        activeProfile: 'transport-recovery-test' });
        const options = (historyMessages) => ({ mode: 'temporary', sessionId: 'voice-temp',
            includeHistory: true, contextCount: 6, historyMessages });
        const history = [{ role: 'user', content: '旧问题' }, { role: 'assistant', content: '旧回复' }];
        const chunks = [];
        const recovered = await chat.chatStream('我们来玩五子棋。', options(history), { onChunk: chunk => chunks.push(chunk) });
        assert.equal(recovered.success, true);
        assert.deepEqual(chunks, ['恢复成功']);
        assert.equal(requests.length, 2);
        assert.deepEqual(requests[1].input, requests[0].input);
        assert.equal(requests[1].previous_response_id, undefined);
        assert.equal(requests[1].input.at(-1).content, '我们来玩五子棋。');

        const partialChunks = [];
        const nextHistory = [...history, { role: 'user', content: '我们来玩五子棋。' },
            { role: 'assistant', content: '恢复成功' }];
        const partial = await chat.chatStream('继续。', options(nextHistory), { onChunk: chunk => partialChunks.push(chunk) });
        assert.equal(partial.success, false);
        assert.deepEqual(partialChunks, ['部分正文']);
        assert.equal(requests.length, 3);
        assert.equal(requests[2].previous_response_id, 'resp_2');

        const fresh = await chat.chatStream('下一轮。', options(nextHistory), {});
        assert.equal(fresh.success, true);
        assert.equal(requests.length, 4);
        assert.equal(requests[3].previous_response_id, undefined);
        assert.equal(requests[3].input.at(-1).content, '下一轮。');
    } finally {
        await new Promise(resolve => server.close(resolve));
        chat.shutdown();
        fs.rmSync(configDir, { recursive: true, force: true });
    }
});
