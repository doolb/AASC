const assert = require('assert/strict');
const { Readable } = require('stream');
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
  assert.equal(calls[0].data.model, 'deepseek-v4-flash');
  assert.doesNotMatch(JSON.stringify(calls[0].data), /token-secret/);
});

test('通用流式 adapter 将上游 SSE 转为 OpenAI chunk 对象', async () => {
  const adapters = createChat2ApiProviderAdapters({
    httpClient: {
      request: async () => ({ status: 200, data: Readable.from(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: [DONE]\n\n']) }),
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

test('Cookie 凭据统一生成 Cookie 头', () => {
  const headers = buildProviderHeaders({}, { credentials: { serviceToken: 's', userId: 'u', phToken: 'p' } }, 'mimo');
  assert.match(headers.Cookie, /serviceToken=s/);
  assert.match(headers.Cookie, /userId=u/);
  assert.match(headers.Cookie, /xiaomichatbot_ph=p/);
});
