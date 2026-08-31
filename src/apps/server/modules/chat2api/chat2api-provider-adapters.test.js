const assert = require('assert/strict');
const { Readable } = require('stream');
const { gzipSync } = require('zlib');
const test = require('node:test');

const { createChat2ApiProviderAdapters, buildProviderHeaders, createQwenRequest } = require('./chat2api-provider-adapters');
const { createRawTrafficLogger } = require('./chat2api-raw-traffic-logger');

test('九个 Provider 都注册统一 HTTP adapter，并按账号凭据生成认证头', async () => {
  const calls = [];
  const adapters = createChat2ApiProviderAdapters({
    httpClient: {
      request: async (config) => {
        calls.push(config);
        if (config.url.includes('/chat_session/create')) return { status: 200, data: { data: { biz_data: { chat_session: { id: 'session-1' } } } } };
        if (config.url.includes('/create_pow_challenge')) return { status: 200, data: { data: { biz_data: { challenge: { algorithm: 'DeepSeekHashV1', challenge: 'x', salt: 's', difficulty: 0, expire_at: 1, signature: 'sig' } } } } };
        return { status: 200, data: { id: 'response-1', choices: [{ message: { role: 'assistant', content: 'ok' }, index: 0, finish_reason: 'stop' }] } };
      },
    },
  });
  assert.deepEqual(Object.keys(adapters).sort(), ['deepseek', 'glm', 'kimi', 'mimo', 'minimax', 'perplexity', 'qwen', 'qwen-ai', 'zai']);
  await adapters.deepseek({
    request: { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }], stream: false },
    account: { credentials: { token: 'token-secret', powResponse: 'pow-response' } },
    provider: { id: 'deepseek', apiEndpoint: 'https://example.com', chatPath: '/chat', headers: {} },
    actualModel: 'deepseek-v4-flash',
  });
  const chatCall = calls.at(-1);
  assert.equal(chatCall.headers.Authorization, 'Bearer token-secret');
  assert.equal(chatCall.data.model_type, 'default');
  assert.equal(chatCall.data.prompt, 'User: hi');
  assert.doesNotMatch(JSON.stringify(chatCall.data), /token-secret/);
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

test('Qwen 不支持原生工具时在上游提示中声明 Responses 工具标签协议', () => {
  const request = createQwenRequest(
    {
      model: 'Qwen3.6-Flash',
      messages: [{ role: 'user', content: '查找文件' }],
      tools: [{ type: 'function', name: 'aasc_find', description: '查找文件', parameters: { type: 'object', required: ['pattern'] } }],
    },
    'Qwen3.7',
    { apiEndpoint: 'https://example.com', chatPath: '/api/v2/chat' },
    {},
    { nativeState: {} },
  );

  assert.match(request.data.messages[0].content, /aasc_find/u);
  assert.match(request.data.messages[0].content, /<\|CHAT2API\|tool_calls>/u);
  assert.match(request.data.messages[0].content, /parameter name/u);
});

test('Qwen 工具提示兼容 Responses 规范化后的 function 嵌套结构', () => {
  const request = createQwenRequest(
    {
      model: 'Qwen3.6-Flash',
      messages: [{ role: 'user', content: '查找文件' }],
      tools: [{ type: 'function', function: { name: 'aasc_find', description: '查找文件', parameters: { type: 'object' } } }],
    },
    'Qwen3.7',
    { apiEndpoint: 'https://example.com', chatPath: '/api/v2/chat' },
    {},
    { nativeState: {} },
  );

  assert.match(request.data.messages[0].content, /aasc_find/u);
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

test('Qwen Responses 会话复用原生 session_id 和 parent_req_id', async () => {
  let requestConfig;
  const adapters = createChat2ApiProviderAdapters({
    httpClient: {
      request: async (config) => {
        requestConfig = config;
        return { status: 200, data: Readable.from(['data: {"communication":{"reqid":"next-req","sessionid":"fixed-session"},"data":{"messages":[{"mime_type":"multi_load/iframe","content":"继续成功"}]}}\n\n']) };
      },
    },
  });

  const result = await adapters.qwen({
    request: { model: 'Qwen3.7', messages: [{ role: 'user', content: '继续' }], stream: false },
    account: { credentials: { ticket: 'ticket-secret' } },
    provider: { id: 'qwen', apiEndpoint: 'https://example.com', chatPath: '/api/v2/chat', headers: {} },
    actualModel: 'Qwen3.7',
    responseSession: { nativeState: { sessionId: 'fixed-session', parentReqId: 'previous-req' } },
  });

  assert.equal(requestConfig.data.session_id, 'fixed-session');
  assert.equal(requestConfig.data.parent_req_id, 'previous-req');
  assert.equal(requestConfig.data.scene_param, 'continue');
  assert.deepEqual(result.nativeState, { sessionId: 'fixed-session', parentReqId: 'next-req' });
});

test('Qwen Responses 首轮生成新 session 时仍使用 first_turn', async () => {
  let requestConfig;
  const adapters = createChat2ApiProviderAdapters({
    httpClient: {
      request: async (config) => {
        requestConfig = config;
        return { status: 200, data: Readable.from(['data: {"communication":{"reqid":"first-req","sessionid":"new-session"},"data":{"messages":[{"mime_type":"multi_load/iframe","content":"首轮成功"}]}}\n\n']) };
      },
    },
  });

  await adapters.qwen({
    request: { model: 'Qwen3.7', messages: [{ role: 'user', content: '首轮' }], stream: false },
    account: { credentials: { ticket: 'ticket-secret' } },
    provider: { id: 'qwen', apiEndpoint: 'https://example.com', chatPath: '/api/v2/chat', headers: {} },
    actualModel: 'Qwen3.7',
    responseSession: { nativeState: {} },
  });

  assert.equal(requestConfig.data.scene_param, 'first_turn');
  assert.equal(requestConfig.data.parent_req_id, '0');
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

test('Provider adapter 开启调试后记录内部 HTTP 请求并关联核心 requestId', async () => {
  const records = [];
  const adapters = createChat2ApiProviderAdapters({
    rawTrafficLogger: createRawTrafficLogger({ sink: (record) => records.push(record) }),
    getConfig: async () => ({ debugRawTraffic: true, rawTrafficMaxBytes: 262144, rawTrafficMode: 'compact' }),
    httpClient: {
      request: async () => ({ status: 200, headers: {}, data: { choices: [{ message: { content: 'ok' } }] } }),
    },
  });
  await adapters.qwen({
    request: { model: 'Qwen3.6-Flash', messages: [{ role: 'user', content: 'hi' }], stream: false },
    account: { credentials: { ticket: 'ticket-secret' } },
    provider: { id: 'qwen', apiEndpoint: 'https://example.com', chatPath: '/api/v2/chat', headers: {} },
    actualModel: 'Qwen3.7',
    context: { requestId: 'chatcmpl-raw-test' },
  });

  assert.equal(records.some((record) => record.requestId === 'chatcmpl-raw-test' && record.event === 'request'), true);
  assert.doesNotMatch(JSON.stringify(records), /ticket-secret/);
  assert.deepEqual(records.find((record) => record.event === 'request').data, { model: 'Qwen3.7', text: 'hi' });
  assert.deepEqual(records.find((record) => record.event === 'response').data, { output: 'ok' });
  assert.doesNotMatch(JSON.stringify(records), /example\.com/);
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
        if (config.url.includes('/device/register')) return { status: 200, data: { statusInfo: { code: 0 }, data: { deviceIDStr: 'device-1', realUserID: 'user' } } };
        if (config.url.includes('/chat_session/create')) return { status: 200, data: { data: { biz_data: { chat_session: { id: 'deepseek-session' } } } } };
        if (config.url.includes('/create_pow_challenge')) return { status: 200, data: { data: { biz_data: { challenge: { algorithm: 'DeepSeekHashV1', challenge: 'x', salt: 's', difficulty: 0, expire_at: 1, signature: 'sig' } } } } };
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
        const providerId = Object.keys(bodies).find((id) => config.url.includes(id));
        return { status: 200, data: Readable.from([bodies[providerId] || 'data: [DONE]\n\n']) };
      },
    },
  });
  const cases = [
    ['deepseek', { token: 'token', powResponse: 'pow-response' }, 'deepseek'],
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

test('native Provider 的非流式请求聚合上游流并保留会话状态', async () => {
  const adapters = createChat2ApiProviderAdapters({
    httpClient: {
      request: async (config) => {
        if (config.url.includes('/chat_session/create')) return { status: 200, data: { data: { biz_data: { chat_session: { id: 'deepseek-session' } } } } };
        return { status: 200, data: Readable.from(['data: {"v":"DeepSeek 回复","response_message_id":"message-2"}\n\n']) };
      },
    },
  });
  const result = await adapters.deepseek({
    request: { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: '你好' }], stream: false },
    account: { credentials: { token: 'token', powResponse: 'pow-response' } },
    provider: { id: 'deepseek', apiEndpoint: 'https://example.com', chatPath: '/chat', headers: {} },
    actualModel: 'deepseek-v4-flash',
    responseSession: { nativeState: {} },
  });

  assert.equal(result.body.choices[0].message.content, 'DeepSeek 回复');
  assert.equal(result.nativeState.sessionId, 'deepseek-session');
  assert.equal(result.nativeState.parentMessageId, 'message-2');
});
