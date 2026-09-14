'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const readSource = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

test('llm-server 通过任务路由注册 OpenAI 兼容接口', () => {
    const source = readSource('src/apps/server/modules/task-engine/builtin-tasks/llm-server.js');
    assert.match(source, /registerRoute/u);
    assert.match(source, /\/v1\/models/u);
    assert.match(source, /\/v1\/chat\/completions/u);
    assert.match(source, /\/v1\/responses/u);
});

test('AASC 8081 在既有固定路由前挂载任务路由兜底', () => {
    const source = readSource('src/apps/server/boot/server-app.js');
    const jsonIndex = source.indexOf("app.use(express.json({ limit: '50mb' }));");
    const routeMiddlewareIndex = source.indexOf('taskManager.handleHttpRoute(req, res)');
    const fixedLlmIndex = source.indexOf("app.get('/v1/models'");
    assert.ok(jsonIndex >= 0);
    assert.ok(routeMiddlewareIndex > jsonIndex);
    assert.ok(fixedLlmIndex > routeMiddlewareIndex);
});

test('TaskManager 向任务上下文提供 LLM HTTP handler', () => {
    const source = readSource('src/apps/server/modules/task-engine/task-manager.js');
    assert.match(source, /_llmHttpHandlers/u);
    assert.match(source, /llmHttpHandlers:/u);
});

test('llm-server 启停时注册并注销四个兼容路由', async () => {
    const task = require('../src/apps/server/modules/task-engine/builtin-tasks/llm-server');
    const registered = [];
    const unregistered = [];
    const result = await task.run({
        llmGatewayService: { getStatus: () => ({ status: 'running', modelCount: 1, displayCount: 1 }) },
        llmHttpHandlers: {
            models: async () => {},
            request: async () => {}
        },
        registerRoute: async (route) => {
            registered.push(route);
            return () => unregistered.push(route.path);
        }
    });

    assert.deepEqual(registered.map((route) => `${route.method} ${route.path}`), [
        'GET /v1/models',
        'POST /v1/chat/completions',
        'POST /v1/responses',
        'POST /v1/chat/responses'
    ]);
    await result.stop();
    assert.deepEqual(unregistered, [
        '/v1/chat/responses',
        '/v1/responses',
        '/v1/chat/completions',
        '/v1/models'
    ]);
});
