const assert = require('assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const test = require('node:test');

const TaskManager = require('./task-manager');

test('TaskManager将应用runtime工厂传入Chat2API一次与服务执行入口', async t => {
  // 对应.src/framework/tts-provider-configuration.md：使用临时任务目录，避免修改用户任务/results。
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-task-upstream-'));
  t.after(() => fs.rmSync(tasksDir, { recursive: true, force: true }));
  let starts = 0, stops = 0;
  const manager = new TaskManager({ tasksDir, chat2apiRuntimeFactory: options => {
    assert.equal(options.rootDir, '/isolated-account-root');
    return { start: async () => { starts++; }, stop: async () => { stops++; }, getStatus: () => ({ running: true }) };
  } });
  const params = { rootDir: '/isolated-account-root' };
  const once = await manager.runBuiltinOnce('chat2api.proxy', params);
  await once.stop(); assert.equal(starts, 1); assert.equal(stops, 1);
  const { instanceId } = await manager.submit({ taskName: 'chat2api.proxy', taskType: 'builtin', builtinId: 'chat2api.proxy',
    mode: 'service', target: 'server', params });
  await manager.runInstance('chat2api.proxy', instanceId);
  for (let index = 0; index < 30 && !manager._services.has(instanceId); index++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 2); assert.equal(manager._services.has(instanceId), true);
  await manager.stopInstance('chat2api.proxy', instanceId); assert.equal(stops, 2);
});

test('TaskManager 将全局 chatService 传给内置 LLM 任务', async () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-task-chat-'));
  const server = require('http').createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ id: 'resp_task_manager', output_text: 'TaskManager 已注入' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const manager = new TaskManager({
      tasksDir,
      chatService: {
        getConfig: () => ({
          model: 'legacy-global-model'
        }),
        getActiveProfile: () => 'qwen',
        getProfileByName: () => ({
          name: 'qwen',
          protocol: 'openai-responses',
          apiUrl: `http://127.0.0.1:${server.address().port}/v1/chat/completions`,
          apiKey: '',
          model: 'qwen'
        })
      }
    });
    const result = await manager.runBuiltinOnce('llm.chat', { messages: '你好' });
    assert.deepEqual(result, { success: true, data: { text: 'TaskManager 已注入' } });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});
