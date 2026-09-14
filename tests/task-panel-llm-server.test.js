'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('llm-server 声明为服务任务并复用通用创建入口', () => {
    const taskSource = read('src/apps/server/modules/task-engine/builtin-tasks/llm-server.js');
    const panelSource = read('src/apps/web-mediacenter/ui/public/js/task-panel.js');

    assert.match(taskSource, /id:\s*'llm-server'/);
    assert.match(taskSource, /mode:\s*'service'/);
    assert.match(
        panelSource,
        /task\.mode\s*===\s*'service'[\s\S]{0,180}this\._viewBuiltinParams\(taskName\)/
    );
    assert.doesNotMatch(
        panelSource,
        /taskName\s*===\s*['"]llm-server['"]/
    );
});

test('llm-server 通过通用 control.actions 声明默认映射页面', () => {
    const taskSource = read('src/apps/server/modules/task-engine/builtin-tasks/llm-server.js');
    const handlerSource = read('src/apps/server/modules/task-engine/web-socket-handler.js');
    const panelSource = read('src/apps/web-mediacenter/ui/public/js/task-panel.js');

    assert.match(taskSource, /configButton:\s*\{[\s\S]*label:\s*['"]默认映射['"][\s\S]*\}/);
    assert.match(taskSource, /control:\s*\{[\s\S]*actions:\s*\[[\s\S]*id:\s*['"]defaultModelMappings['"][\s\S]*placement:\s*['"]task['"]/);
    assert.match(handlerSource, /configButton:\s*t\.configButton\s*\|\|\s*null/);
    assert.match(handlerSource, /control:\s*t\.control\s*\|\|\s*null/);
    assert.match(panelSource, /_openTaskControl/);
    assert.match(panelSource, /_dispatchTaskControlMessage/);
    assert.doesNotMatch(panelSource, /_showLlmDefaultMappings/);
    assert.doesNotMatch(panelSource, /task\.configButton\s*&&\s*task\.configButton\.id/);
});

test('llm-server 控制页面脚本可以由通用 Control API 编译', () => {
    const task = require('../src/apps/server/modules/task-engine/builtin-tasks/llm-server');
    const action = task.control.actions.find((item) => item.id === 'defaultModelMappings');

    assert.ok(action);
    assert.doesNotThrow(() => new Function('api', action.script));
    assert.match(action.html, /data-role="rows"/);
    assert.match(action.script, /api\.sendMessage\(\{ type: 'llm\.defaultModelMappings\.get' \}\)/);
});

test('内置任务注册表向任务列表保留默认映射按钮元数据', () => {
    const registry = require('../src/apps/server/modules/task-engine/builtin-tasks/registry');
    const llmTask = registry.listTasks().find((task) => task.id === 'llm-server');

    assert.ok(llmTask);
    assert.deepEqual(llmTask.configButton, {
        id: 'defaultModelMappings',
        label: '默认映射'
    });
});

test('LLM 默认映射使用带 type 的 WebSocket 配置消息并广播权威值', () => {
    const serverSource = read('src/apps/server/boot/server-app.js');
    const snapshotSource = read('src/core/data-snapshot/DataSnapshot.js');
    const taskSource = read('src/apps/server/modules/task-engine/builtin-tasks/llm-server.js');
    const panelSource = read('src/apps/web-mediacenter/ui/public/js/task-panel.js');

    assert.match(serverSource, /type:\s*['"]llm\.defaultModelMappings['"]/);
    assert.match(serverSource, /data\.type\s*===\s*['"]llm\.defaultModelMappings\.set['"]/);
    assert.match(serverSource, /config\.set\(['"]llm\.defaultModelMappings['"]/);
    assert.match(serverSource, /const saved = config\.set\(['"]llm\.defaultModelMappings['"]/);
    assert.match(serverSource, /if \(!saved\)/);
    assert.match(snapshotSource, /return saved;/);
    assert.match(taskSource, /let dirty = false/);
    assert.match(taskSource, /const sent = api\.sendMessage/);
    assert.match(taskSource, /type:\s*['"]llm\.defaultModelMappings\.set['"]/);
    assert.match(taskSource, /api\.onMessage\(['"]llm\.defaultModelMappingsError['"]/);
    assert.match(panelSource, /_dispatchTaskControlMessage/);
});
