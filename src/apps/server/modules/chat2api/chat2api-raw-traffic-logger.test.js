const assert = require('assert/strict');
const { Readable } = require('stream');
const test = require('node:test');

const {
  createRawTrafficLogger,
} = require('./chat2api-raw-traffic-logger');

const createClient = ({ records, enabled = true, maxBytes = 262144, response }) => {
  const logger = createRawTrafficLogger({ sink: (record) => records.push(record) });
  return logger.createHttpClient({
    httpClient: { request: async () => response },
    providerId: 'qwen',
    context: { requestId: 'chatcmpl-test-1' },
    enabled,
    maxBytes,
  });
};

test('原始流量日志会脱敏 URL、请求头和嵌套凭据', async () => {
  const records = [];
  const client = createClient({
    records,
    response: { status: 200, headers: { 'set-cookie': 'session=reply-secret' }, data: { answer: 'ok', token: 'reply-secret' } },
  });
  await client.request({
    method: 'POST',
    url: 'https://qwen.test/chat?token=query-secret&safe=1',
    headers: { Authorization: 'Bearer request-secret', Cookie: 'session=request-secret' },
    data: { messages: [{ role: 'user', content: '保留这段内容' }], nested: { accessToken: 'nested-secret' } },
  });

  const output = JSON.stringify(records);
  assert.match(output, /保留这段内容/);
  assert.match(output, /REDACTED/);
  assert.doesNotMatch(output, /request-secret|reply-secret|query-secret|nested-secret/);
  assert.match(output, /chatcmpl-test-1/);
});

test('调试关闭时不产生原始数据日志且不改变响应', async () => {
  const records = [];
  const response = { status: 200, headers: {}, data: { answer: 'same-result' } };
  const client = createClient({ records, enabled: false, response });
  const result = await client.request({ method: 'POST', url: 'https://qwen.test/chat', data: { secret: 'not-logged' } });

  assert.equal(result, response);
  assert.deepEqual(records, []);
});

test('流式响应记录原始块后仍原样透传并受字节预算限制', async () => {
  const records = [];
  const chunks = [Buffer.from(`data: ${'a'.repeat(700)}\n\n`), Buffer.from(`data: ${'b'.repeat(700)}\n\n`)];
  const client = createClient({
    records,
    maxBytes: 1024,
    response: { status: 200, headers: { 'content-type': 'text/event-stream' }, data: Readable.from(chunks) },
  });
  const result = await client.request({ method: 'POST', url: 'https://qwen.test/chat', data: { prompt: 'hello' } });
  const received = [];
  for await (const chunk of result.data) received.push(Buffer.from(chunk));

  assert.deepEqual(Buffer.concat(received), Buffer.concat(chunks));
  assert.equal(records.some((record) => record.truncated === true), true);
});
