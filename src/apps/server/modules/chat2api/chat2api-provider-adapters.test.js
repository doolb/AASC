const assert = require('assert/strict');
const { Readable } = require('stream');
const { gzipSync } = require('zlib');
const test = require('node:test');

const { createChat2ApiProviderAdapters, buildProviderHeaders } = require('./chat2api-provider-adapters');

test('九个 Provider 都注册统一 HTTP adapter，并按账号凭据生成认证头', async () => {
  const calls = [];
  const adapters = createChat2ApiProviderAdapters({
    httpClient: {
      request: async (config) => {
        calls.push(config);
        return { status: 200, data: { id: 'response-1', choices: [{ message: { role: 'assistant', content: 'ok' }, index: 0, finish_reason: 'stop' }] } };
      },
    },
  });
  assert.deepEqual(Object.keys(adapters).sort(), ['deepseek', 'glm', 'kimi', 'mimo', 'minimax', 'perplexity', 'qwen', 'qwen-ai', 'zai']);
  await adapters.deepseek({
    request: { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }], stream: false },
    account: { credentials: { token: 'token-secret' } },
    provider: { id: 'deepseek', apiEndpoint: 'https://example.com', chatPath: '/chat', headers: {} },
    actualModel: 'deepseek-v4-flash',
  });
  assert.equal(calls[0].headers.Authorization, 'Bearer token-secret');
  assert.equal(calls[0].data.model_type, 'default');
  assert.equal(calls[0].data.prompt, 'User: hi');
  assert.doesNotMatch(JSON.stringify(calls[0].data), /token-secret/);
});

test('通用流式 adapter 将上游 SSE 转为 OpenAI chunk 对象', async () => {
  const adapters = createChat2ApiProviderAdapters({
    httpClient: {
      request: async (config) => config.url.includes('/api/v1/chats/new')
        ? { status: 200, data: { id: 'zai-chat-1' } }
        : { status: 200, data: Readable.from(['data: {"type":"chat:completion","data":{"phase":"answer","delta_content":"hi"}}\n\n', 'data: [DONE]\n\n']) },
    },
  });
  const result = await adapters.zai({
    request: { model: 'GLM-5', messages: [{ role: 'user', content: 'hi' }], stream: true },
    account: { credentials: { token: 'token-secret' } },
    provider: { id: 'zai', apiEndpoint: 'https://example.com', chatPath: '/chat', headers: {} },
    actualModel: 'GLM-5',
  });
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  assert.equal(chunks[0].choices[0].delta.content, 'hi');
});

test('Qwen 非流式响应解析 data.messages 中的实际答案内容', async () => {
  const calls = [];
  const adapters = createChat2ApiProviderAdapters({
    httpClient: {
      request: async (config) => {
        calls.push(config);
        return {
        status: 200,
        data: Readable.from([
          'data: {"communication":{"reqid":"qwen-1"},"data":{"messages":[{"mime_type":"multi_load/iframe","content":"测试成功","status":"complete"}]}}\n\n',
        ]),
        headers: { 'content-encoding': 'identity' },
        };
      },
    },
  });
  const result = await adapters.qwen({
    request: { model: 'Qwen3.6-Flash', messages: [{ role: 'user', content: 'hi' }], stream: false },
    account: { credentials: { ticket: 'ticket-secret' } },
    provider: { id: 'qwen', apiEndpoint: 'https://example.com', chatPath: '/api/v2/chat', headers: {} },
    actualModel: 'Qwen3.7',
  });

  assert.equal(result.body.choices[0].message.content, '测试成功');
  assert.equal(result.body.id, 'qwen-1');
  assert.match(calls[0].url, /\/api\/v2\/chat\?[^ ]*biz_id=ai_qwen/);
  assert.equal(calls[0].data.model, 'Qwen3.7');
  assert.equal(calls[0].data.messages[0].content, 'hi');
  assert.equal(calls[0].data.messages[0].mime_type, 'text/plain');
  assert.match(calls[0].headers.Cookie, /tongyi_sso_ticket=ticket-secret/);
  assert.equal(calls[0].headers.Authorization, undefined);
});

test('Qwen gzip SSE 先解压再解析，避免压缩字节被当成空响应', async () => {
  const sse = 'data:{"data":{"messages":[{"mime_type":"multi_load/iframe","content":"gzip成功","status":"complete"}]}}\n\n';
  const adapters = createChat2ApiProviderAdapters({
    httpClient: {
      request: async () => ({
        status: 200,
        headers: { 'content-encoding': 'gzip' },
        data: Readable.from([gzipSync(Buffer.from(sse, 'utf8'))]),
      }),
    },
  });
  const result = await adapters.qwen({
    request: { model: 'Qwen3.6-Flash', messages: [{ role: 'user', content: 'hi' }], stream: false },
    account: { credentials: { ticket: 'ticket-secret' } },
    provider: { id: 'qwen', apiEndpoint: 'https://example.com', chatPath: '/api/v2/chat', headers: {} },
    actualModel: 'Qwen3.7',
  });

  assert.equal(result.body.choices[0].message.content, 'gzip成功');
});

test('Qwen 流式响应按累计内容只输出新增文本并过滤思考标记', async () => {
  const adapters = createChat2ApiProviderAdapters({
    httpClient: {
      request: async () => ({
        status: 200,
        data: Readable.from([
          'data: {"data":{"messages":[{"mime_type":"multi_load/iframe","content":"[(deep_think)]你","status":"running"}]}}\n\n',
          'data: {"data":{"messages":[{"mime_type":"multi_load/iframe","content":"[(deep_think)]你好","status":"complete"}]}}\n\n',
        ]),
      }),
    },
  });
  const result = await adapters.qwen({
    request: { model: 'Qwen3.6-Flash', messages: [{ role: 'user', content: 'hi' }], stream: true },
    account: { credentials: { ticket: 'ticket-secret' } },
    provider: { id: 'qwen', apiEndpoint: 'https://example.com', chatPath: '/api/v2/chat', headers: {} },
    actualModel: 'Qwen3.7',
  });
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);

  assert.deepEqual(chunks.map((chunk) => chunk.choices[0].delta.content), ['你', '好']);
});

test('Cookie 凭据统一生成 Cookie 头', () => {
  const headers = buildProviderHeaders({}, { credentials: { serviceToken: 's', userId: 'u', phToken: 'p' } }, 'mimo');
  assert.match(headers.Cookie, /serviceToken=s/);
  assert.match(headers.Cookie, /userId=u/);
  assert.match(headers.Cookie, /xiaomichatbot_ph=p/);
});

test('各内置 Provider 使用原版专用请求协议并归一化流式文本', async () => {
  const frame = (value) => {
    const payload = Buffer.from(JSON.stringify(value));
    const result = Buffer.alloc(5 + payload.length);
    result.writeUInt32BE(payload.length, 1);
    payload.copy(result, 5);
    return result;
  };
  const adapters = createChat2ApiProviderAdapters({
    httpClient: {
      request: async (config) => {
        if (config.url.includes('/user-api/user/refresh')) return { status: 200, data: { result: { access_token: 'glm-access' } } };
        if (config.url.includes('/chats/new')) return { status: 200, data: { data: { id: 'qwen-chat' }, id: 'zai-chat' } };
        if (config.url.includes('/conversation/save')) return { status: 200, data: { code: 0 } };
        const bodies = {
          deepseek: 'data: {"v":"deepseek"}\n\n',
          glm: 'data: {"parts":[{"content":[{"type":"text","text":"glm"}]}]}\n\n',
          mimo: 'event: message\ndata: {"content":"mimo","type":"message"}\n\n',
          minimax: 'event: message_result\ndata: {"data":{"messageResult":{"content":"minimax","isEnd":0}}}\n\n',
          perplexity: 'data: {"text":"perplexity"}\n\n',
          'qwen-ai': 'data: {"choices":[{"delta":{"phase":"answer","content":"qwen-ai"}}]}\n\n',
          zai: 'data: {"type":"chat:completion","data":{"phase":"answer","delta_content":"zai"}}\n\n',
        };
        if (config.url.includes('/apiv2/kimi.gateway')) return { status: 200, data: Readable.from([frame({ block: { text: { content: 'kimi' } } })]) };
        const providerId = Object.keys(bodies).find((id) => config.url.includes(id === 'qwen-ai' ? 'qwen.ai' : id === 'minimax' ? 'minimaxi' : id));
        return { status: 200, data: Readable.from([bodies[providerId] || 'data: [DONE]\n\n']) };
      },
    },
  });
  const cases = [
    ['deepseek', { token: 'token' }, 'deepseek'],
    ['glm', { refresh_token: 'refresh' }, 'glm'],
    ['kimi', { token: 'token' }, 'kimi'],
    ['mimo', { service_token: 's', user_id: 'u', ph_token: 'p' }, 'mimo'],
    ['minimax', { token: 'token', realUserID: 'user' }, 'minimax'],
    ['perplexity', { sessionToken: 'session' }, 'perplexity'],
    ['qwen-ai', { token: 'token', cookies: 'sid=c' }, 'qwen-ai'],
    ['zai', { token: 'token' }, 'zai'],
  ];
  for (const [providerId, credentials, expected] of cases) {
    const provider = { id: providerId, apiEndpoint: `https://${providerId}.example.com`, chatPath: '/chat', headers: {} };
    const result = await adapters[providerId]({
      request: { model: 'model', originalModel: 'model', messages: [{ role: 'user', content: 'hi' }], stream: true },
      account: { credentials }, provider, actualModel: 'actual-model',
    });
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    assert.ok(chunks.length > 0, `Provider ${providerId} 未产生标准 chunk`);
    assert.equal(chunks[0].choices[0].delta.content, expected, providerId);
  }
});
