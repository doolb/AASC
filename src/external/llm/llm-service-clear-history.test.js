'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-clear-responses-'));
const pathsModule = require.resolve('../../apps/server/modules/config/user-config-paths');
require.cache[pathsModule] = { id: pathsModule, filename: pathsModule, loaded: true,
    exports: { USER_CONFIG_DIR: configDir } };
const chat = require('./llm-service');

test('清空指定私聊同时清除各 profile/template 续接引用，其他会话保留', async () => {
    const requests = [];
    const server = http.createServer(async (incoming, response) => {
        let raw = '';
        for await (const chunk of incoming) raw += chunk;
        const request = JSON.parse(raw);
        requests.push(request);
        const id = `resp_${requests.length}`;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ id, conversation: { id: `conv_${requests.length}` },
            output_text: `答复 ${requests.length}` }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const apiUrl = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
        const makeProfile = name => ({ name, mode: 'llm', protocol: 'openai-responses',
            apiUrl, model: 'qwen', maxTokens: 1000, temperature: 0.7 });
        chat.init({ llmProfiles: [makeProfile('profile-a'), makeProfile('profile-b')],
            activeProfile: 'profile-a' });
        const scope = (target, sessionId, templateTarget = target) => ({ mode: 'private',
            target, sessionId, templateTarget, includeHistory: true, contextCount: 10 });

        assert.equal((await chat.chat('旧问题 A', scope('角色甲', 'default'))).success, true);
        assert.equal((await chat.chat('旧问题 A 默认模板', scope('角色甲', 'default', 'default'))).success, true);
        assert.equal(chat.switchProfile('profile-b'), true);
        assert.equal((await chat.chat('旧问题 B', scope('角色甲', 'default'))).success, true);
        assert.equal((await chat.chat('另一会话', scope('角色甲', 'other'))).success, true);
        assert.equal((await chat.chat('另一角色', scope('角色乙', 'default'))).success, true);

        chat.clearHistory({ mode: 'private', target: '角色甲', sessionId: 'default' });
        const states = JSON.parse(fs.readFileSync(path.join(configDir, 'chat-responses-sessions.json'), 'utf8'));
        assert.deepEqual(Object.values(states).map(state => state.latestResponseId).sort(),
            ['resp_4', 'resp_5']);

        assert.equal((await chat.chat('继续另一会话', scope('角色甲', 'other'))).success, true);
        assert.equal(requests[5].previous_response_id, 'resp_4');
        assert.equal((await chat.chat('清空后新问题', scope('角色甲', 'default'))).success, true);
        assert.equal(requests[6].previous_response_id, undefined);
        assert.equal(requests[6].conversation, undefined);
        assert.equal(JSON.stringify(requests[6].input).includes('旧问题'), false);
        assert.equal(chat.switchProfile('profile-a'), true);
        assert.equal((await chat.chat('A 的新问题', scope('角色甲', 'default'))).success, true);
        assert.equal(requests[7].previous_response_id, undefined);
    } finally {
        await new Promise(resolve => server.close(resolve));
        chat.shutdown();
        fs.rmSync(configDir, { recursive: true, force: true });
    }
});
