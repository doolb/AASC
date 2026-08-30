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
      };
    },
    postWidgetUpdate: (data) => { widget = data; },
    onWidgetAction: (name, handler) => actionHandlers.set(name, handler),
  });
  assert.equal(result.type, 'service');
  assert.equal(typeof actionHandlers.get('widgetRefresh'), 'function');
  assert.equal(widget.statusText, '运行中');
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
