const assert = require('assert/strict');
const http = require('http');
const test = require('node:test');

const { createResponsesClient } = require('./llm-responses-client');

const startServer = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

const closeServer = async (server) => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};

test('Responses 客户端发送 JSON 请求并解析 output_text', async () => {
  let request;
  const server = await startServer((incoming, response) => {
    request = incoming;
    let body = '';
    incoming.on('data', (chunk) => { body += chunk; });
    incoming.on('end', () => {
      assert.equal(incoming.url, '/v1/responses');
      assert.equal(incoming.headers.authorization, 'Bearer test-key');
      assert.deepEqual(JSON.parse(body), { model: 'qwen', input: '你好', stream: false });
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ id: 'resp_1', output_text: '你好，世界' }));
    });
  });

  try {
    const client = createResponsesClient({
      baseUrl: `http://127.0.0.1:${server.address().port}/v1/`,
      apiKey: 'test-key'
    });
    const result = await client.request({ model: 'qwen', input: '你好', stream: false });
    assert.equal(result.output_text, '你好，世界');
    assert.equal(request.method, 'POST');
  } finally {
    await closeServer(server);
  }
});

test('Responses 客户端解析流式事件并忽略 DONE', async () => {
  const events = [];
  const server = await startServer((_incoming, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: {"type":"response.created"}\n\n');
    response.write('data: {"type":"response.output_text.delta","delta":"你好"}\n\n');
    response.write('data: [DONE]\n\n');
    response.end();
  });

  try {
    const client = createResponsesClient({ baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
    await client.stream({ model: 'qwen', input: '你好', stream: true }, (event) => events.push(event));
    assert.deepEqual(events, [
      { type: 'response.created' },
      { type: 'response.output_text.delta', delta: '你好' }
    ]);
  } finally {
    await closeServer(server);
  }
});

test('Responses 客户端将 HTTP 错误转换为可识别错误', async () => {
  const server = await startServer((_incoming, response) => {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: '鉴权失败', code: 'invalid_api_key' } }));
  });

  try {
    const client = createResponsesClient({ baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
    await assert.rejects(
      () => client.request({ model: 'qwen', input: '你好' }),
      (error) => error.statusCode === 401 && error.code === 'invalid_api_key' && error.message === '鉴权失败'
    );
  } finally {
    await closeServer(server);
  }
});
