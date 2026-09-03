const assert = require('assert/strict');
const test = require('node:test');

const task = require('./chat2api-proxy');
const registry = require('./registry');

test('chat2api.proxy 注册为 server service 内置任务', () => {
  const registered = registry.getTask('chat2api.proxy');
  assert.equal(registered, task);
  assert.equal(registered.mode, 'service');
  assert.equal(registered.target, 'server');
  assert.equal(registered.params.some((item) => item.name === 'port'), true);
  assert.match(registered.widget.html, /手动导入网页会话记录/);
});

test('chat2api.proxy 任务启动并能通过 stop 释放 runtime', async () => {
  let stopped = false;
  let runtimeOptions;
  let widget;
  const actionHandlers = new Map();
  const result = await task.run({
    params: { host: '127.0.0.1', port: 8080, enableApiKey: false },
    chat2apiRuntimeFactory: (options) => {
      runtimeOptions = options;
      return {
        start: async () => ({ address: '127.0.0.1', port: 8080 }),
        stop: async () => { stopped = true; },
        getStatus: () => ({ running: true }),
        managementService: {
          importQwenWebConversations: async () => ({ imported: 2, total: 2, failed: 0, indexFile: 'tmp/qwen-web-import/index.json' }),
        },
      };
    },
    postWidgetUpdate: (data) => { widget = data; },
    onWidgetAction: (name, handler) => actionHandlers.set(name, handler),
  });
  assert.equal(result.type, 'service');
  assert.equal(typeof actionHandlers.get('widgetRefresh'), 'function');
  assert.equal(typeof actionHandlers.get('importQwenWebHistory'), 'function');
  assert.equal(widget.statusText, '运行中');
  const importResult = await actionHandlers.get('importQwenWebHistory')();
  assert.equal(importResult.success, true);
  assert.equal(widget.qwenImportText, '已导入 2/2 个会话');
  assert.equal(widget.qwenImportPath, 'tmp/qwen-web-import/index.json');
  await result.stop();
  assert.equal(stopped, true);

  await task.run({
    params: { host: '127.0.0.1', port: 8080, enableApiKey: 'false' },
    chat2apiRuntimeFactory: (options) => {
      runtimeOptions = options;
      return { start: async () => {}, stop: async () => {}, getStatus: () => ({ running: true }) };
    },
  });
  assert.equal(runtimeOptions.config.enableApiKey, false);
});

test('chat2api.proxy 导入失败时转义任务卡片中的错误文本', async () => {
  let widget;
  const actionHandlers = new Map();
  await task.run({
    params: { host: '127.0.0.1', port: 8080, enableApiKey: false },
    chat2apiRuntimeFactory: () => ({
      start: async () => {},
      stop: async () => {},
      getStatus: () => ({ running: true }),
      managementService: {
        importQwenWebConversations: async () => { throw new Error('<img src=x onerror=alert(1)>'); },
      },
    }),
    postWidgetUpdate: (data) => { widget = data; },
    onWidgetAction: (name, handler) => actionHandlers.set(name, handler),
  });

  const result = await actionHandlers.get('importQwenWebHistory')();
  assert.equal(result.success, false);
  assert.equal(widget.qwenImportText, '导入失败：&lt;img src=x onerror=alert(1)&gt;');
});
