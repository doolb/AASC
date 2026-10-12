const assert = require('assert/strict');
const http = require('http');
const test = require('node:test');

const { createChat2ApiProxyService } = require('./chat2api-proxy-service');
const { createChat2ApiCoreAdapter } = require('./chat2api-core-adapter');
const { createChat2ApiResponsesService } = require('./chat2api-responses-service');
const { createDoubaoChatAdapter } = require('./chat2api-doubao-chat-adapter');
const { PassThrough } = require('stream');

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
      addManualAccount: async (input) => ({ account: { accountId: 'manual-1', providerId: input.providerId } }),
      exportConfig: async () => ({ format: 'aasc-chat2api-config', version: 1, config: {}, providers: [], accounts: [], modelMappings: [] }),
      exportAccountCredentials: async () => ({ format: 'aasc-chat2api-accounts', version: 1, accounts: [] }),
      previewAccountImport: async () => ({ counts: { new: 1, update: 0, invalid: 0 }, items: [], confirmation: 'confirmation-1' }),
      mergeAccountImport: async (data, confirmation, confirmed) => ({ data, confirmation, confirmed }),
      createAccountWebSession: async (accountId) => ({ mode: 'account-web', sessionId: 'session-1', accountId }),
      consumeAccountWebSession: async (sessionId) => ({ sessionId, loginUrl: 'https://www.qianwen.com', credentials: {} }),
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
    const accountExport = await request(service.address().port, { path: '/api/chat2api/accounts/export', method: 'GET' });
    assert.equal(accountExport.statusCode, 200);
    assert.equal(JSON.parse(accountExport.text).format, 'aasc-chat2api-accounts');
    assert.equal(accountExport.headers['cache-control'], 'no-store');
    const accountPreview = await request(service.address().port, { path: '/api/chat2api/accounts/import/preview', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ format: 'aasc-chat2api-accounts', version: 1, accounts: [] }));
    assert.equal(accountPreview.statusCode, 200);
    assert.equal(JSON.parse(accountPreview.text).confirmation, 'confirmation-1');
    const accountMerge = await request(service.address().port, { path: '/api/chat2api/accounts/import/merge', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ data: { accounts: [] }, confirmation: 'confirmation-1', confirmed: true }));
    assert.equal(JSON.parse(accountMerge.text).confirmed, true);
    const webSession = await request(service.address().port, { path: '/api/chat2api/accounts/qwen%3Auser%40example.com/web-session', method: 'POST', headers: { 'Content-Type': 'application/json' } }, '{}');
    assert.equal(JSON.parse(webSession.text).sessionId, 'session-1');
    const consumedSession = await request(service.address().port, { path: '/api/chat2api/accounts/web-session/consume', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ sessionId: 'session-1' }));
    assert.equal(JSON.parse(consumedSession.text).sessionId, 'session-1');
    assert.equal(consumedSession.headers['cache-control'], 'no-store');
    const login = await request(service.address().port, { path: '/api/chat2api/oauth/start', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ providerId: 'deepseek' }));
    assert.equal(login.statusCode, 200);
    assert.equal(JSON.parse(login.text).state, 'state-1');
    const manual = await request(service.address().port, { path: '/api/chat2api/accounts/manual', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ providerId: 'deepseek', credentials: { token: 'secret' } }));
    assert.equal(manual.statusCode, 200);
    assert.equal(JSON.parse(manual.text).account.accountId, 'manual-1');
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

test('代理服务透传 Responses 上游账号不可用错误', async () => {
  const service = createChat2ApiProxyService({
    host: '127.0.0.1', port: 0, config: { enableApiKey: false },
    coreAdapter: { listModels: async () => ({ object: 'list', data: [] }), forwardChatCompletion: async () => ({ body: {} }) },
    responsesService: {
      createResponse: async () => {
        const error = new Error('没有可用账号');
        error.statusCode = 503;
        error.code = 'no_available_account';
        throw error;
      },
    },
  });
  await service.start();
  try {
    const response = await request(
      service.address().port,
      { path: '/v1/responses', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      JSON.stringify({ model: 'Qwen3.6-Flash', input: '你好' })
    );
    const payload = JSON.parse(response.text);
    assert.equal(response.statusCode, 503);
    assert.equal(payload.error.code, 'no_available_account');
    assert.equal(payload.error.message, '没有可用账号');
  } finally {
    await service.stop();
  }
});

// 本地真实 HTTP 仅测试客户端断连；官网请求由注入 mock 接管，不读取真实账号或操作 Chrome。
const createDeferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const withDeadline = async (promise) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('断连未在测试期限内取消')), 1500); })]);
  } finally { clearTimeout(timer); }
};
const createDoubaoHttpFixture = (httpClient) => {
  const provider = { id: 'doubaochat', apiEndpoint: 'https://www.doubao.com', chatPath: '/chat/completion' };
  const account = { accountId: 'doubao_mock', providerId: 'doubaochat', credentials: {
    cookie: 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789',
  } };
  const sessions = new Map();
  const coreAdapter = createChat2ApiCoreAdapter({
    dataStore: { getAccount: async () => account, listAccounts: async () => [account] },
    providerRegistry: { listProviders: async () => [provider] },
    modelMapper: { resolveModel: async (model) => ({ actualModel: model }) },
    loadBalancer: { selectAccount: async () => ({ provider, account, actualModel: 'doubao' }) },
    providerAdapters: { doubaochat: createDoubaoChatAdapter({ httpClient }) },
  });
  const responsesService = createChat2ApiResponsesService({
    coreAdapter,
    sessionStore: {
      get: async (id) => sessions.get(id), findByResponseId: async () => null,
      save: async (session) => { sessions.set(session.conversationId, session); },
      withLock: async (id, operation) => operation(),
    },
  });
  const service = createChat2ApiProxyService({
    host: '127.0.0.1', port: 0, config: { enableApiKey: false }, coreAdapter, responsesService,
  });
  return { service, sessions };
};

test('HTTP流式客户端断线立即取消豆包上游；Chat与Responses都释放源且不保存不完整会话', { timeout: 5000 }, async () => {
  for (const path of ['/v1/chat/completions', '/v1/responses']) {
    const source = new PassThrough();
    source.write('event: CHUNK_DELTA\ndata: {"text":"首片"}\n\n');
    const cancelled = createDeferred();
    const closed = createDeferred();
    source.once('close', closed.resolve);
    let signal;
    const { service, sessions } = createDoubaoHttpFixture({ request: async (config) => {
      signal = config.signal;
      signal.addEventListener('abort', cancelled.resolve, { once: true });
      return { status: 200, headers: { 'content-type': 'text/event-stream' }, data: source };
    } });
    await service.start();
    let client;
    try {
      const first = createDeferred();
      client = http.request({ host: '127.0.0.1', port: service.address().port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
        res.once('data', () => { res.destroy(); first.resolve(); });
        res.on('error', () => {});
      });
      client.on('error', () => {});
      client.end(JSON.stringify(path === '/v1/responses' ? { model: 'doubao', input: 'hello', stream: true }
        : { model: 'doubao', messages: [{ role: 'user', content: 'hello' }], stream: true }));
      await withDeadline(first.promise);
      await withDeadline(cancelled.promise);
      await withDeadline(closed.promise);
      assert.equal(signal.aborted, true);
      assert.equal(source.destroyed, true);
      assert.equal(sessions.size, 0);
    } finally {
      if (client) client.destroy();
      source.destroy();
      await service.stop();
    }
  }
});

test('HTTP非流式握手等待期间断线立即中止豆包请求，上传正常完成本身不误触发取消', { timeout: 5000 }, async () => {
  for (const path of ['/v1/chat/completions', '/v1/completions', '/v1/responses']) {
    const started = createDeferred();
    const cancelled = createDeferred();
    let signal;
    const { service, sessions } = createDoubaoHttpFixture({ request: (config) => {
      signal = config.signal;
      started.resolve();
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        cancelled.resolve(); reject(new Error('mock上游取消，不得暴露原文'));
      }, { once: true }));
    } });
    await service.start();
    let client;
    try {
      client = http.request({ host: '127.0.0.1', port: service.address().port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } });
      client.on('error', () => {});
      const payload = path === '/v1/responses' ? { model: 'doubao', input: 'hello' }
        : path === '/v1/completions' ? { model: 'doubao', prompt: 'hello' }
          : { model: 'doubao', messages: [{ role: 'user', content: 'hello' }] };
      client.end(JSON.stringify(payload));
      await withDeadline(started.promise);
      assert.equal(signal.aborted, false);
      client.destroy();
      await withDeadline(cancelled.promise);
      assert.equal(signal.aborted, true);
      assert.equal(sessions.size, 0);
    } finally {
      if (client) client.destroy();
      await service.stop();
    }
  }
});

test('正常HTTP非流和流结束不触发内部signal取消，各请求signal独立', async () => {
  const signals = [];
  const service = createService(false, { forwardChatCompletion: async (payload, options) => {
    signals.push(options.signal);
    if (payload.stream) return { stream: (async function* chunks() { yield { choices: [{ delta: { content: 'ok' } }] }; }()) };
    return { body: { choices: [{ message: { content: 'ok' } }] } };
  } });
  await service.start();
  try {
    for (const stream of [false, true]) await request(service.address().port,
      { path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      JSON.stringify({ model: 'public-chat', messages: [{ role: 'user', content: 'hello' }], stream }));
    assert.equal(signals.length, 2);
    assert.notEqual(signals[0], signals[1]);
    assert.equal(signals.every((signal) => signal.aborted === false), true);
  } finally { await service.stop(); }
});
