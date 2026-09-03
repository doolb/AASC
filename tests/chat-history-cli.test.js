'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const scriptsDir = path.join(root, 'scripts', 'api');
const {
    filterHistory,
    filterSessions,
    parseArgs,
    toOutputPayload,
    toSessionNamesPayload
} = require('../scripts/api/chat-history');
const { formatSessions } = require('../scripts/api/chat-tui');

const history = [
    {
        id: 'legacy-1',
        timestamp: 100,
        user: '旧版问题',
        assistant: '旧版回答',
        mode: 'group',
        sessionId: 'default',
        profileName: 'default'
    },
    {
        id: 'modern-1',
        timestamp: 200,
        role: 'user',
        name: '用户',
        content: '私聊问题',
        mode: 'private',
        target: '小爱',
        sessionId: 'session-1',
        profileName: 'private-profile'
    },
    {
        id: 'modern-2',
        timestamp: 300,
        role: 'assistant',
        name: '小爱',
        content: '私聊回答',
        mode: 'private',
        target: '小爱',
        sessionId: 'session-1',
        profileName: 'private-profile'
    }
];

test('聊天历史 CLI 解析只读过滤和 TUI 参数', () => {
    assert.deepEqual(parseArgs([
        '--sessions',
        '--mode', 'private',
        '--target', '小爱',
        '--session', 'session-1',
        '--profile', 'private-profile',
        '--limit', '20',
        '--width', '72',
        '--tui'
    ]), {
        mode: 'private',
        target: '小爱',
        sessionId: 'session-1',
        profileName: 'private-profile',
        limit: 20,
        width: 72,
        tui: true,
        sessions: true,
        help: false
    });
    assert.throws(() => parseArgs(['--mode', 'unknown']), /--mode/);
    assert.throws(() => parseArgs(['--limit', '0']), /--limit/);
});

test('聊天查看 CLI 的 sessions 参数不要求 target', () => {
    assert.equal(parseArgs(['--sessions']).sessions, true);
    assert.equal(parseArgs([]).sessions, false);
});

test('聊天历史过滤器按会话字段筛选并保留最近消息', () => {
    const result = filterHistory(history, {
        mode: 'private',
        target: '小爱',
        sessionId: 'session-1',
        profileName: 'private-profile',
        limit: 1
    });

    assert.deepEqual(result.map((message) => message.id), ['modern-2']);
});

test('聊天历史输出保持 API 外壳并只替换过滤后的 history', () => {
    const payload = { status: 'success', history, requestId: 'read-only' };
    const result = toOutputPayload(payload, { mode: 'group', limit: 10 });

    assert.equal(result.status, 'success');
    assert.equal(result.requestId, 'read-only');
    assert.deepEqual(result.history.map((message) => message.id), ['legacy-1']);
});

test('聊天查看 CLI 只输出角色名和 session 名', () => {
    const sessions = [
        { mode: 'private', target: '小爱', id: 'default', name: '默认会话', createdAt: 10 },
        { mode: 'private', target: '妲己', id: 'work', name: '工作', createdAt: 20 }
    ];
    const result = toSessionNamesPayload(
        { status: 'success', sessions },
        { status: 'success', history: [] },
        {}
    );

    assert.equal(result.status, 'success');
    assert.deepEqual(result.sessions, [
        { target: '小爱', name: '默认会话' },
        { target: '妲己', name: '工作' }
    ]);
    assert.equal(Object.hasOwn(result, 'history'), false);
});

test('session 列表按 target 和 sessionId 过滤', () => {
    const result = filterSessions([
        { target: '小爱', id: 'default' },
        { target: '小爱', id: 'work' },
        { target: '妲己', id: 'default' }
    ], { target: '小爱', sessionId: 'work' });

    assert.deepEqual(result, [{ target: '小爱', id: 'work' }]);
});

test('目标模式为旧版 session 条目补回请求 target', () => {
    const result = toSessionNamesPayload(
        { status: 'success', sessions: [{ id: 'default', name: '默认会话', createdAt: 10 }] },
        { status: 'success', history: [] },
        { target: '小爱' }
    );

    assert.deepEqual(result.sessions, [{ target: '小爱', name: '默认会话' }]);
});

test('session TUI 只渲染角色名和 session 名', () => {
    const output = formatSessions({
        status: 'success',
        sessions: [
            { target: '群聊', name: '群聊首句' },
            { target: '小爱', name: '当前会话' }
        ]
    }, 60);

    assert.match(output, /会话列表/);
    assert.match(output, /群聊 · 群聊首句/);
    assert.match(output, /小爱 · 当前会话/);
    assert.match(output, /当前会话/);
    assert.doesNotMatch(output, /session-1/);
    assert.doesNotMatch(output, /200/);
    assert.doesNotMatch(output, /私聊问题|私聊回答|旧版问题|旧版回答/);
});

test('聊天查看脚本只调用现有 GET 接口并提供 session TUI 入口', () => {
    const source = fs.readFileSync(path.join(scriptsDir, 'chat-history.js'), 'utf8');
    const tuiSource = fs.readFileSync(path.join(scriptsDir, 'chat-tui.js'), 'utf8');

    assert.match(source, /requestText\('GET', '\/api\/chat\/history'\)/);
    assert.match(source, /requestText\('GET', sessionRoute\(options\.target\)\)/);
    assert.doesNotMatch(source, /history\/export/);
    assert.match(source, /--tui/);
    assert.doesNotMatch(source, /requestText\('(POST|PUT|DELETE)'/);
    assert.match(tuiSource, /formatSessions/);
});

test('chat-history --sessions 只调用现有只读接口并输出群聊和私聊名称', async () => {
    const requests = [];
    const server = http.createServer((request, response) => {
        requests.push(`${request.method} ${request.url}`);
        response.setHeader('Content-Type', 'application/json');
        if (request.method === 'GET' && request.url === '/api/chat/sessions') {
            response.end(JSON.stringify({
                status: 'success',
                sessions: [{ target: '小爱', id: 'hidden-id', name: '当前会话', createdAt: 123 }]
            }));
            return;
        }
        if (request.method === 'GET' && request.url === '/api/chat/history') {
            response.end(JSON.stringify({
                status: 'success',
                history: [{
                    mode: 'group',
                    target: null,
                    sessionId: 'default',
                    role: 'control',
                    content: '群聊首句'
                }]
            }));
            return;
        }
        response.statusCode = 404;
        response.end(JSON.stringify({ status: 'error', message: 'unexpected route' }));
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const scriptPath = path.join(scriptsDir, 'chat-history.js');
    const child = spawn(process.execPath, [scriptPath, '--sessions'], {
        cwd: root,
        env: {
            ...process.env,
            AASC_URL: `http://127.0.0.1:${address.port}`,
            AASC_INSECURE: '1',
            AASC_TIMEOUT_SECONDS: '5',
            AASC_CONNECT_TIMEOUT_SECONDS: '1'
        }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    try {
        const result = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, signal) => resolve({ code, signal }));
        });
        assert.deepEqual(result, { code: 0, signal: null }, stderr);
        assert.deepEqual(requests.sort(), ['GET /api/chat/history', 'GET /api/chat/sessions']);
        assert.deepEqual(JSON.parse(stdout), {
            status: 'success',
            sessions: [
                { target: '群聊', name: '群聊首句' },
                { target: '小爱', name: '当前会话' }
            ]
        });
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
