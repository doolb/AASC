'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { TaskRouteRegistry } = require('../src/apps/server/modules/task-engine/task-route-registry');

class TestResponse extends EventEmitter {
    constructor() {
        super();
        this.statusCode = 200;
        this.headers = {};
        this.body = '';
        this.writableEnded = false;
        this.writableFinished = false;
        this.headersSent = false;
    }

    status(statusCode) {
        this.statusCode = statusCode;
        return this;
    }

    setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value;
    }

    getHeader(name) {
        return this.headers[String(name).toLowerCase()];
    }

    json(payload) {
        this.setHeader('content-type', 'application/json; charset=utf-8');
        this.body = JSON.stringify(payload);
        this.headersSent = true;
        this.end();
        return this;
    }

    write(chunk) {
        this.headersSent = true;
        this.body += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
        return true;
    }

    end(chunk = '') {
        if (chunk !== undefined && chunk !== null) this.body += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
        this.headersSent = true;
        this.writableEnded = true;
        this.writableFinished = true;
        this.emit('finish');
        return this;
    }

    flushHeaders() {
        this.headersSent = true;
    }
}

function waitForTurn() {
    return new Promise((resolve) => setImmediate(resolve));
}

test('服务端任务路由接收结构化请求并返回响应', async () => {
    const registry = new TaskRouteRegistry();
    registry.registerServerRoute({
        taskName: 'route-task',
        instanceId: 'server-instance',
        method: 'post',
        path: '/api/echo',
        handler: async ({ request, response }) => {
            response.status(201).json({ value: request.body.value, query: request.query.mode });
        }
    });

    const response = new TestResponse();
    const handled = registry.handleRequest({
        method: 'POST',
        path: '/api/echo',
        query: { mode: 'test' },
        headers: { 'x-test': 'yes' },
        body: { value: 7 }
    }, response);

    assert.equal(handled, true);
    await waitForTurn();
    assert.equal(response.statusCode, 201);
    assert.deepEqual(JSON.parse(response.body), { value: 7, query: 'test' });
});

test('同一 method/path 不能被不同任务实例重复注册', () => {
    const registry = new TaskRouteRegistry();
    registry.registerServerRoute({
        taskName: 'first-task',
        instanceId: 'first-instance',
        method: 'GET',
        path: '/health',
        handler: async () => ({ ok: true })
    });

    assert.throws(
        () => registry.registerServerRoute({
            taskName: 'second-task',
            instanceId: 'second-instance',
            method: 'GET',
            path: '/health',
            handler: async () => ({ ok: true })
        }),
        (error) => error.code === 'TASK_ROUTE_CONFLICT' && error.statusCode === 409
    );
});

test('注销任务实例后其路由不再命中', async () => {
    const registry = new TaskRouteRegistry();
    registry.registerServerRoute({
        taskName: 'cleanup-task',
        instanceId: 'cleanup-instance',
        method: 'GET',
        path: '/cleanup',
        handler: async () => ({ ok: true })
    });
    assert.equal(registry.getRoutes().length, 1);

    registry.unregisterInstance('cleanup-instance');
    assert.equal(registry.getRoutes().length, 0);
    assert.equal(registry.handleRequest({ method: 'GET', path: '/cleanup', query: {}, headers: {} }, new TestResponse()), false);
});

test('显示端断开时清理路由并让等待中的 HTTP 请求返回 503', async () => {
    const sent = [];
    const registry = new TaskRouteRegistry({
        sendToDisplay: (displayId, message) => {
            sent.push({ displayId, message });
            return true;
        }
    });
    const registered = registry.registerDisplayRoute({
        taskName: 'display-task',
        instanceId: 'display-instance',
        displayId: 'display-a',
        routeId: 'display-route-1',
        method: 'POST',
        path: '/display/echo'
    });
    const response = new TestResponse();

    assert.equal(registry.handleRequest({
        method: 'POST',
        path: '/display/echo',
        query: {},
        headers: {},
        body: { hello: 'display' }
    }, response), true);
    assert.equal(sent[0].message.type, 'task:route_request');
    assert.equal(sent[0].message.payload.routeId, registered.routeId);

    registry.unregisterDisplay('display-a');
    await waitForTurn();
    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), {
        error: { code: 'TASK_ROUTE_TARGET_UNAVAILABLE', message: '目标显示端已断开' }
    });
    assert.equal(registry.getRoutes().length, 0);
});

test('显示端响应支持 headers、chunk 和 end 事件', async () => {
    const sent = [];
    const registry = new TaskRouteRegistry({
        sendToDisplay: (displayId, message) => {
            sent.push({ displayId, message });
            return true;
        }
    });
    const registered = registry.registerDisplayRoute({
        taskName: 'stream-task',
        instanceId: 'stream-instance',
        displayId: 'display-stream',
        routeId: 'stream-route-1',
        method: 'GET',
        path: '/stream'
    });
    const response = new TestResponse();
    registry.handleRequest({ method: 'GET', path: '/stream', query: {}, headers: {} }, response);
    const requestId = sent[0].message.payload.requestId;

    registry.handleDisplayResponse('display-stream', {
        routeId: registered.routeId,
        requestId,
        event: 'headers',
        statusCode: 200,
        headers: { 'content-type': 'text/plain' }
    });
    registry.handleDisplayResponse('display-stream', {
        routeId: registered.routeId,
        requestId,
        event: 'chunk',
        data: 'hello '
    });
    registry.handleDisplayResponse('display-stream', {
        routeId: registered.routeId,
        requestId,
        event: 'end',
        data: 'world'
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/plain');
    assert.equal(response.body, 'hello world');
    assert.equal(response.writableEnded, true);
});
