const assert = require('assert/strict');
const http = require('http');
const test = require('node:test');

const { createChat2ApiProxyService } = require('./chat2api-proxy-service');

const request = (port, options, body) => new Promise((resolve, reject) => {
  const req = http.request({ port, host: '127.0.0.1', ...options }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { text += chunk; });
    res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, text }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

const createService = (enableApiKey = true, overrides = {}) => createChat2ApiProxyService({
  host: '127.0.0.1', port: 0,
  config: { enableApiKey },
  dataStore: {
    validateApiKey: async (value) => (value === 'test-key' ? { id: 'key-1' } : null),
  },
  coreAdapter: {
    listModels: async () => ({ object: 'list', data: [{ id: 'public-chat', object: 'model', owned_by: 'test' }] }),
    forwardChatCompletion: async (payload) => ({ body: {
      id: 'chatcmpl-test', object: 'chat.completion', model: payload.model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    } }),
    ...overrides,
  },
});

test('代理服务提供 models、Bearer 鉴权和非流式 chat completions', async () => {
  const service = createService(true);
  await service.start();
  try {
    const unauthorized = await request(service.address().port, { path: '/v1/models', method: 'GET' });
    assert.equal(unauthorized.statusCode, 401);
    const health = await request(service.address().port, { path: '/health', method: 'GET' });
    assert.equal(health.statusCode, 200);
    assert.equal(JSON.parse(health.text).status, 'running');
    assert.equal(typeof JSON.parse(health.text).statistics.totalRequests, 'number');
    const models = await request(service.address().port, { path: '/v1/models', method: 'GET', headers: { Authorization: 'Bearer test-key' } });
    assert.equal(models.statusCode, 200);
    assert.equal(JSON.parse(models.text).data[0].id, 'public-chat');
    const chat = await request(service.address().port, {
      path: '/v1/chat/completions', method: 'POST', headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    }, JSON.stringify({ model: 'public-chat', messages: [{ role: 'user', content: 'hello' }] }));
    assert.equal(chat.statusCode, 200);
    assert.equal(JSON.parse(chat.text).choices[0].message.content, 'ok');
  } finally {
    await service.stop();
  }
});

test('代理服务把流式结果转换为 SSE，并在停止时释放端口', async () => {
  const service = createService(false, { forwardChatCompletion: async () => ({
    stream: (async function* streamChunks() {
      yield { id: 'chunk-1', object: 'chat.completion.chunk', choices: [{ delta: { content: '流式' }, index: 0, finish_reason: null }] };
      yield { id: 'chunk-2', object: 'chat.completion.chunk', choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] };
    }()),
  }) });
  await service.start();
  const port = service.address().port;
  const response = await request(port, { path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ model: 'public-chat', messages: [{ role: 'user', content: 'hello' }], stream: true }));
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/event-stream/);
  assert.match(response.text, /data: \{"id":"chunk-1"/);
  assert.match(response.text, /data: \[DONE\]/);
  await service.stop();
  await assert.rejects(() => request(port, { path: '/health', method: 'GET' }));
});

test('代理服务向本机控制端提供 Chat2API 管理接口', async () => {
  const service = createChat2ApiProxyService({
    host: '127.0.0.1', port: 0, config: { enableApiKey: true },
    dataStore: { validateApiKey: async () => null },
    coreAdapter: { listModels: async () => ({ object: 'list', data: [] }), forwardChatCompletion: async () => ({ body: {} }) },
    managementService: { listProviders: async () => [{ id: 'deepseek' }], startLogin: async () => ({ state: 'state-1' }) },
  });
  await service.start();
  try {
    const response = await request(service.address().port, { path: '/api/chat2api/providers', method: 'GET' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.text), [{ id: 'deepseek' }]);
    const login = await request(service.address().port, { path: '/api/chat2api/oauth/start', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ providerId: 'deepseek' }));
    assert.equal(login.statusCode, 200);
    assert.equal(JSON.parse(login.text).state, 'state-1');
  } finally {
    await service.stop();
  }
});
