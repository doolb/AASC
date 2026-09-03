'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const upload = fs.readFileSync(path.join(root, 'src/apps/web-mediacenter/ui/public/upload.html'), 'utf8');
const search = fs.readFileSync(path.join(root, 'src/apps/web-mediacenter/ui/public/js/search.js'), 'utf8');
const websocket = fs.readFileSync(path.join(root, 'src/apps/web-mediacenter/ui/public/js/websocket.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/apps/server/boot/server-app.js'), 'utf8');
const voiceCommand = fs.readFileSync(path.join(root, 'src/apps/web-mediacenter/modules/voice/voice-command-app-service.js'), 'utf8');
const llm = fs.readFileSync(path.join(root, 'src/external/llm/llm-service.js'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'src/apps/server/modules/task-engine/builtin-tasks/registry.js'), 'utf8');
const taskManager = fs.readFileSync(path.join(root, 'src/apps/server/modules/task-engine/task-manager.js'), 'utf8');
const taskPanel = fs.readFileSync(path.join(root, 'src/apps/web-mediacenter/ui/public/js/task-panel.js'), 'utf8');

test('控制端提供独立搜索频道和历史容器', () => {
    assert.match(upload, /data-target="search"/u);
    assert.match(upload, /id="panel-search"/u);
    assert.match(upload, /id="searchHistoryList"/u);
    assert.match(upload, /id="searchChannelList"/u);
});

test('搜索频道能接收状态并在历史同步后刷新', () => {
    assert.match(search, /handleChannel\(data\)/u);
    assert.match(search, /searchChannel/u);
    assert.match(websocket, /window\.Search\.handleChannel\(data\)/u);
    assert.match(websocket, /window\.Chat\.renderSearchHistory\(\)/u);
});

test('搜索命令使用独立搜索路由而不是普通群聊路由', () => {
    assert.match(voiceCommand, /type:\s*'search'[\s\S]{0,220}route:\s*'llm'/u);
    assert.match(server, /result\.type === 'search'/u);
    assert.match(server, /searchChannel/u);
    const searchHandlerStart = server.indexOf('async function handleLlmSearchCommand');
    const searchHandlerEnd = server.indexOf('\nconst deviceEventDebounce', searchHandlerStart);
    assert.ok(searchHandlerStart >= 0 && searchHandlerEnd > searchHandlerStart);
    assert.doesNotMatch(server.slice(searchHandlerStart, searchHandlerEnd), /handleChatMessage\(/u);
    assert.match(server.slice(searchHandlerStart, searchHandlerEnd), /const useEphemeralAgent = activeProfile\?\.mode === 'agent'/u);
    assert.match(server.slice(searchHandlerStart, searchHandlerEnd), /\['pi', 'codex'\]\.includes\(activeProfile\?\.backend\)/u);
    assert.match(server.slice(searchHandlerStart, searchHandlerEnd), /ephemeral:\s*useEphemeralAgent/u);
    assert.match(llm, /ephemeral/u);
});

test('系统搜索委托给可手动调用的单次内置任务', () => {
    assert.match(registry, /search\.web/u);
    assert.match(taskManager, /runBuiltinOnce/u);
    assert.match(voiceCommand, /setSearchRunner/u);
    assert.match(server, /runBuiltinOnce\(['"]search\.web['"]/u);
});

test('手动任务结果面板渲染 data.result 数组', () => {
    assert.match(taskPanel, /result\.data\.result/u);
    assert.match(taskPanel, /Array\.isArray\(resultData\)/u);
});

test('历史实例收到 task:result 时补建内存结果状态', () => {
    assert.match(taskPanel, /if \(!inst\) \{[\s\S]{0,700}this\.instances\.set\(payload\.instanceId, inst\)/u);
});

test('手动提交完成后详情面板保持选中新实例', () => {
    assert.match(taskPanel, /this\._selectTask\(payload\.taskName\);[\s\S]{0,180}this\._selectedInstanceId = payload\.instanceId;/u);
});

console.log('search-channel.test.js: contract checks passed');
