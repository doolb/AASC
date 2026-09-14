'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('服务端任务 WebSocket handler 注册显示端路由协议消息', () => {
    const source = read('src/apps/server/modules/task-engine/web-socket-handler.js');
    assert.match(source, /'task:route_register'/u);
    assert.match(source, /'task:route_unregister'/u);
    assert.match(source, /'task:route_response'/u);
    assert.match(source, /handleTaskRouteRegister/u);
    assert.match(source, /handleTaskRouteResponse/u);
    assert.match(source, /task:route_registered/u);
});

test('浏览器显示端提供任务路由注册、请求处理和响应消息', () => {
    const source = read('src/apps/web-mediacenter/ui/public/display.html');
    assert.match(source, /task:route_register/u);
    assert.match(source, /task:route_registered/u);
    assert.match(source, /task:route_request/u);
    assert.match(source, /task:route_response/u);
    assert.match(source, /task:route_cancel/u);
    assert.match(source, /registerRoute/u);
});

test('Node 子显示端提供任务路由注册、请求处理和响应消息', () => {
    const source = read('src/apps/voice-display-node/main.js');
    assert.match(source, /task:route_register/u);
    assert.match(source, /task:route_registered/u);
    assert.match(source, /task:route_request/u);
    assert.match(source, /task:route_response/u);
    assert.match(source, /task:route_cancel/u);
    assert.match(source, /registerRoute/u);
});

test('显示端服务转发负载包含 mode，客户端可以区分服务任务', () => {
    const source = read('src/apps/server/modules/task-engine/task-manager.js');
    assert.match(source, /mode: task\.mode \|\| 'one-shot'/u);
    assert.match(source, /_registerServerTaskRoute/u);
});
