const assert = require('assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const test = require('node:test');

const TaskManager = require('./task-manager');

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
          protocol: 'openai-responses',
          responsesBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
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
