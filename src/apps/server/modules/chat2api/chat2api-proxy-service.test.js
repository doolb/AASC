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
    managementService: {
      listProviders: async () => [{ id: 'deepseek' }],
      exportConfig: async () => ({ format: 'aasc-chat2api-config', version: 1, config: {}, providers: [], accounts: [], modelMappings: [] }),
      startLogin: async () => ({ state: 'state-1' }),
      previewLegacyImport: async () => ({ counts: { providers: 1, accounts: 1, modelMappings: 1 } }),
      mergeLegacyImport: async (confirmed) => ({ confirmed }),
      importQwenWebConversations: async (input) => ({ imported: input.limit ? 2 : 1, total: input.limit || 1, failed: 0 }),
    },
  });
  await service.start();
  try {
    const response = await request(service.address().port, { path: '/api/chat2api/providers', method: 'GET' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.text), [{ id: 'deepseek' }]);
    const exported = await request(service.address().port, { path: '/api/chat2api/export', method: 'GET' });
    assert.equal(exported.statusCode, 200);
    assert.match(exported.headers['content-disposition'], /attachment/);
    assert.equal(JSON.parse(exported.text).format, 'aasc-chat2api-config');
    const login = await request(service.address().port, { path: '/api/chat2api/oauth/start', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ providerId: 'deepseek' }));
    assert.equal(login.statusCode, 200);
    assert.equal(JSON.parse(login.text).state, 'state-1');
    const preview = await request(service.address().port, { path: '/api/chat2api/import/legacy/preview', method: 'POST', headers: { 'Content-Type': 'application/json' } }, '{}');
    assert.equal(preview.statusCode, 200);
    assert.equal(JSON.parse(preview.text).counts.accounts, 1);
    const merge = await request(service.address().port, { path: '/api/chat2api/import/legacy/merge', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ confirmed: true }));
    assert.equal(merge.statusCode, 200);
    assert.equal(JSON.parse(merge.text).confirmed, true);
    const qwenImport = await request(service.address().port, { path: '/api/chat2api/qwen/web-import', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ limit: 2 }));
    assert.equal(qwenImport.statusCode, 200);
    assert.deepEqual(JSON.parse(qwenImport.text), { imported: 2, total: 2, failed: 0 });
  } finally {
    await service.stop();
  }
});

test('代理服务提供 Responses 非流式和流式接口', async () => {
  const received = [];
  const service = createChat2ApiProxyService({
    host: '127.0.0.1', port: 0, config: { enableApiKey: false },
    coreAdapter: { listModels: async () => ({ object: 'list', data: [] }), forwardChatCompletion: async () => ({ body: {} }) },
    responsesService: {
      createResponse: async (payload) => {
        received.push(payload);
        if (payload.stream) {
          return { stream: (async function* events() {
            yield { type: 'response.created', response: { id: 'resp_stream' } };
            yield { type: 'response.completed', response: { id: 'resp_stream' } };
          }()) };
        }
        return { body: { id: 'resp_test', object: 'response', output_text: 'ok' } };
      },
    },
  });
  await service.start();
  try {
    const nonStream = await request(service.address().port, { path: '/v1/responses', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ model: 'public-chat', input: 'hello' }));
    assert.equal(nonStream.statusCode, 200);
    assert.equal(JSON.parse(nonStream.text).object, 'response');
    const stream = await request(service.address().port, { path: '/v1/responses', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ model: 'public-chat', input: 'hello', stream: true }));
    assert.equal(stream.statusCode, 200);
    assert.match(stream.headers['content-type'], /text\/event-stream/);
    assert.match(stream.text, /response.created/);
    assert.match(stream.text, /data: \[DONE\]/);
    assert.equal(received.length, 2);
  } finally {
    await service.stop();
  }
});
