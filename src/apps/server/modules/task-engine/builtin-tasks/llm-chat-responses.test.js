const assert = require('assert/strict');
const http = require('http');
const test = require('node:test');

const task = require('./llm-chat');

const startServer = async (stream) => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push({ url: request.url, body: parsed, headers: request.headers });
      response.setHeader('Content-Type', stream ? 'text/event-stream' : 'application/json');
      if (!stream) {
        response.end(JSON.stringify({ id: 'resp_task', output_text: '任务响应成功' }));
        return;
      }
      response.write('data: {"type":"response.output_text.delta","delta":"流式任务成功"}\n\n');
      response.write('data: {"type":"response.completed","response":{"id":"resp_task_stream","conversation":{"id":"conv_task"}}}\n\n');
      response.write('data: [DONE]\n\n');
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, requests };
};

const closeServer = async (server) => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};

const profileConfig = (port) => ({
  name: 'qwen',
  protocol: 'openai-responses',
  apiUrl: `http://127.0.0.1:${port}/v1/chat/completions`,
  apiKey: 'profile-key',
  model: 'qwen'
});

test('llm.chat 任务的非流式请求使用当前 profile 的 Responses', async () => {
  const { server, requests } = await startServer(false);
  try {
    const profile = profileConfig(server.address().port);
    const result = await task.run({
      params: { modelId: 'qwen', messages: '你好' },
      chatService: {
        getConfig: () => ({ model: 'legacy-global-model' }),
        getActiveProfile: () => profile.name,
        getProfileByName: () => profile
      }
    });
    assert.deepEqual(result, { success: true, data: { text: '任务响应成功' } });
    assert.equal(requests[0].url, '/v1/responses');
    assert.equal(requests[0].body.model, 'qwen');
    assert.equal(requests[0].body.stream, false);
    assert.equal(requests[0].headers.authorization, 'Bearer profile-key');
  } finally {
    await closeServer(server);
  }
});

test('llm.chat 任务的流式请求转发当前 profile 的 Responses 文本增量', async () => {
  const chunks = [];
  const { server, requests } = await startServer(true);
  try {
    const profile = profileConfig(server.address().port);
    const result = await task.run({
      params: { messages: '你好' },
      postStream: (chunk) => chunks.push(chunk),
      chatService: {
        getConfig: () => ({ model: 'legacy-global-model' }),
        getActiveProfile: () => profile.name,
        getProfileByName: () => profile
      }
    });
    assert.equal(result.success, true);
    assert.equal(result.data.text, '流式任务成功');
    assert.equal(chunks.some((chunk) => chunk.chunk === '流式任务成功'), true);
    assert.equal(chunks.at(-1).done, true);
    assert.equal(requests[0].url, '/v1/responses');
    assert.equal(requests[0].body.model, 'qwen');
    assert.equal(requests[0].body.stream, true);
    assert.equal(requests[0].headers.authorization, 'Bearer profile-key');
  } finally {
    await closeServer(server);
  }
});
