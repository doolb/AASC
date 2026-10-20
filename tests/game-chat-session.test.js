const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { createGameChatSession } = require('../src/apps/server/modules/game/game-chat-session');

function fixture(t, onModelRequest) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-game-chat-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const events = [];
    const session = createGameChatSession({ filePath: path.join(directory, 'gomoku.json'),
        displayId: 'test-display', onModelRequest, onEvent: event => events.push(event) });
    return { session, events };
}

test('独立 JS 入口完成目录、规则、开局及一轮双方落子', async t => {
    const requests = [];
    const replies = [
        'Game:目录,AI,列表',
        'Game:五子棋,AI,规则',
        'Game:五子棋,User,开局,9\n9 路棋盘已打开。',
        'Game:五子棋,User,落子,C3',
        'Game:五子棋,AI,落子,D3\n我下 D3，轮到你了。'
    ];
    const { session, events } = fixture(t, async request => {
        requests.push(request);
        return replies.shift();
    });
    const opening = await session.sendUser('我们来玩五子棋，开一盘 9 路的');
    assert.equal(opening.result.message, '9 路棋盘已打开。');
    assert.equal(opening.snapshot.size, 9);
    assert.equal(opening.snapshot.revision, 1);
    assert.match(requests[1].input, /Game:目录,GM,列表,五子棋/);
    assert.match(requests[2].input, /Game:五子棋,GM,规则,/);
    assert.match(requests[0].systemPrompt, /NowGame:无/);
    assert.deepEqual(opening.events.filter(event => event.type === 'gameProtocol').map(event => event.kind),
        ['AI', 'GM', 'AI', 'GM', 'User', 'GM']);
    const move = await session.sendUser('我下在 C3');
    assert.equal(move.result.message, '我下 D3，轮到你了。');
    assert.equal(move.snapshot.revision, 3);
    assert.equal(move.snapshot.board.split('/')[2].slice(2, 4), 'XO');
    assert.match(requests[3].systemPrompt, /NowGame:五子棋/);
    assert.match(requests[4].input, /Game:五子棋,GM,落子,/);
    assert.deepEqual(move.events.filter(event => event.type === 'gameProtocol').map(event => event.kind),
        ['User', 'GM', 'AI', 'GM']);
    assert.equal(events.filter(event => event.type === 'gameUpdate').length, 3);
});

test('普通聊天不改棋局，旧调用仍由同一入口执行', async t => {
    const replies = ['这里的 Game:五子棋,AI,落子,C3 只是示例。',
        '请看 <Game:五子棋,User,开局,9>棋盘。'];
    const { session } = fixture(t, async () => replies.shift());
    const plain = await session.sendUser('解释一下协议');
    assert.equal(plain.result.message, '这里的 Game:五子棋,AI,落子,C3 只是示例。');
    assert.equal(plain.snapshot, null);
    const legacy = await session.sendUser('开始 9 路五子棋');
    assert.equal(legacy.result.message, '请看 棋盘。');
    assert.equal(legacy.snapshot.size, 9);
});

test('真实聊天模式把会话选项交给原有 chatStream', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-game-chat-real-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const requests = [];
    const messages = [];
    const chat = { splitIntoSentences: value => [value], getActiveProfile: () => 'qwen',
        getTemplateByName: name => name === '小爱' ? { name, content: '小爱的现有设定' } : null,
        addMessage(message) { messages.push(message); return message; },
        async chatStream(input, options) {
            requests.push({ input, options, savedMessages: messages.slice() });
            return { success: true, message: '你好。', history: [] };
        } };
    const session = createGameChatSession({ filePath: path.join(directory, 'gomoku.json'),
        displayId: 'real-chat-display', chat, roleName: '小爱' });
    const result = await session.sendUser('你好', { sessionId: 'same-session' });
    assert.equal(result.result.message, '你好。');
    assert.equal(requests[0].input, '你好');
    assert.equal(requests[0].options.sessionId, 'same-session');
    assert.equal(requests[0].options.mode, 'private');
    assert.equal(requests[0].options.target, '小爱');
    assert.equal(requests[0].options.templateTarget, '小爱');
    assert.equal(requests[0].options.includeHistory, true);
    assert.equal(requests[0].options.contextCount, 100);
    assert.match(requests[0].options.systemPrompt, /NowGame:无/);
    assert.match(requests[0].options.systemPrompt, /小爱的现有设定/);
    assert.equal(result.events[0].type, 'modelRequest');
    await session.sendUser('继续聊', { sessionId: 'same-session' });
    assert.equal(requests[1].options.sessionId, 'same-session');
    assert.deepEqual(requests[1].savedMessages.map(message => message.content),
        ['你好', '你好。', '继续聊']);
    assert.deepEqual(messages.map(message => [message.role, message.content]), [
        ['control', '你好'], ['assistant', '你好。'], ['control', '继续聊'], ['assistant', '你好。']
    ]);
    assert.ok(messages.every(message => message.sessionId === 'same-session'));
    assert.ok(messages.every(message => message.templateId === '小爱' && message.profileName === 'qwen'));
});

test('raw 真实聊天携带前轮历史且不重复插入已在 System 中的角色设定', async () => {
    const chat = require('../src/external/llm/llm-service');
    const originalConfig = chat.getConfig();
    const originalTemplates = chat.getTemplates();
    let requestInput = '';
    const server = http.createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        requestInput = JSON.parse(Buffer.concat(chunks).toString('utf8')).input[0].content;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end('data: {"type":"response.output_text.delta","delta":"好的"}\n\ndata: [DONE]\n\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        chat.setProfiles([{ name: 'game-raw-test', mode: 'llm', protocol: 'openai-responses',
            apiUrl: `http://127.0.0.1:${server.address().port}/v1/responses`,
            model: 'test-model', maxTokens: 4000, promptFormat: 'raw' }]);
        chat.setTemplates([{ id: '测试角色', name: '测试角色', content: '你是测试角色。' }],
            { persist: false });
        const result = await chat.chatStream('我下 C3', { mode: 'private', target: '测试角色',
            templateTarget: '测试角色', sessionId: 'raw-context-test', includeHistory: true,
            contextCount: 100, systemPrompt: '协议提示\n\n你是测试角色。',
            historyMessages: [{ role: 'control', content: '开局' },
                { role: 'assistant', content: '已开局' }] });
        assert.equal(result.success, true);
        assert.match(requestInput, /System:协议提示\n\n你是测试角色。/);
        assert.match(requestInput, /User:开局\nAI:已开局\nUser:我下 C3$/);
        assert.equal(requestInput.split('你是测试角色。').length - 1, 1);
    } finally {
        chat.setTemplates(originalTemplates, { persist: false });
        chat.setConfig(originalConfig);
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

test('非法游戏调用回送错误且不写入棋盘', async t => {
    const replies = ['Game:五子棋,GM,开局,9', '收到。'];
    const requests = [];
    const { session } = fixture(t, async request => {
        requests.push(request);
        return replies.shift();
    });
    const result = await session.sendUser('开局');
    assert.equal(result.snapshot, null);
    assert.match(requests[1].input, /Game:五子棋,GM,错误,调用行格式无效/);
    assert.match(result.result.message, /棋盘未变化/);
});

test('交互式 JSON 行脚本可按 GM 回执逐次接收目标 AI 回复', async t => {
    const child = spawn(process.execPath, [path.join(__dirname, '../scripts/demo/game-chat-session.js')],
        { stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => child.kill());
    const output = readline.createInterface({ input: child.stdout });
    const backlog = [];
    const waiters = [];
    output.on('line', line => {
        const event = JSON.parse(line);
        const index = waiters.findIndex(waiter => waiter.predicate(event));
        if (index < 0) backlog.push(event);
        else {
            const [waiter] = waiters.splice(index, 1);
            clearTimeout(waiter.timeout);
            waiter.resolve(event);
        }
    });
    const next = predicate => {
        const index = backlog.findIndex(predicate);
        if (index >= 0) return Promise.resolve(backlog.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
            const waiter = { predicate, resolve, timeout: setTimeout(() => {
                waiters.splice(waiters.indexOf(waiter), 1);
                reject(new Error('等待交互式入口输出超时'));
            }, 3000) };
            waiters.push(waiter);
        });
    };
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
    await next(event => event.type === 'ready');
    send({ type: 'user', content: '开始 9 路五子棋' });
    const request = await next(event => event.type === 'modelRequest');
    assert.match(request.systemPrompt, /NowGame:无/);
    send({ type: 'modelReply', sequence: request.sequence,
        message: 'Game:五子棋,User,开局,9\n棋盘已经打开。' });
    const result = await next(event => event.type === 'chatResult');
    assert.equal(result.result.message, '棋盘已经打开。');
    assert.equal(result.snapshot.size, 9);
    child.stdin.end();
});
