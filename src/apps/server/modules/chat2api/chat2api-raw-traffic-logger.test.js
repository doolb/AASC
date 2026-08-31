const assert = require('assert/strict');
const { Readable } = require('stream');
const { gzipSync } = require('zlib');
const test = require('node:test');

const {
  createRawTrafficLogger,
} = require('./chat2api-raw-traffic-logger');

const createClient = ({ records, enabled = true, maxBytes = 262144, mode = 'full', response }) => {
  const logger = createRawTrafficLogger({ sink: (record) => records.push(record) });
  return logger.createHttpClient({
    httpClient: { request: async () => response },
    providerId: 'qwen',
    context: { requestId: 'chatcmpl-test-1' },
    enabled,
    maxBytes,
    mode,
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

test('简洁模式只记录请求模型、文本和响应输出', async () => {
  const records = [];
  const client = createClient({
    records,
    mode: 'compact',
    response: {
      status: 200,
      headers: { 'x-request-id': 'provider-request-id' },
      data: { choices: [{ message: { role: 'assistant', content: '成都今天22度' } }] },
    },
  });
  await client.request({
    method: 'POST',
    url: 'https://qwen.test/chat?token=should-not-log',
    headers: { Authorization: 'Bearer should-not-log' },
    data: { model: 'Qwen3.7', messages: [{ role: 'user', content: '成都天气怎么样？' }] },
  });

  const requestRecord = records.find((record) => record.event === 'request');
  const responseRecord = records.find((record) => record.event === 'response');
  assert.deepEqual(requestRecord.data, { model: 'Qwen3.7', text: '成都天气怎么样？' });
  assert.deepEqual(responseRecord.data, { output: '成都今天22度' });
  assert.equal(records.some((record) => record.event === 'response_chunk'), false);
  assert.doesNotMatch(JSON.stringify(records), /qwen\.test|should-not-log|provider-request-id/);
});

test('简洁模式会聚合流式响应为一条输出日志', async () => {
  const records = [];
  const chunks = [
    Buffer.from('data: {"choices":[{"delta":{"content":"成都"}}]}\n\n'),
    Buffer.from('data: {"choices":[{"delta":{"content":"今天晴"}}]}\n\n'),
    Buffer.from('data: [DONE]\n\n'),
  ];
  const client = createClient({
    records,
    mode: 'compact',
    response: { status: 200, headers: { 'content-type': 'text/event-stream' }, data: Readable.from(chunks) },
  });
  const result = await client.request({
    method: 'POST',
    url: 'https://qwen.test/chat',
    data: { model: 'Qwen3.7', messages: [{ role: 'user', content: '天气' }] },
  });
  for await (const chunk of result.data) void chunk;

  const responseRecords = records.filter((record) => record.event === 'response');
  assert.equal(responseRecords.length, 1);
  assert.deepEqual(responseRecords[0].data, { output: '成都今天晴' });
  assert.equal(records.some((record) => record.event === 'response_chunk'), false);
});

test('简洁模式兼容 Qwen data.messages 响应结构', async () => {
  const records = [];
  const client = createClient({
    records,
    mode: 'compact',
    response: { status: 200, headers: {}, data: { data: { messages: [{ content: 'Qwen 的最终回答' }] } } },
  });
  await client.request({
    method: 'POST',
    url: 'https://qwen.test/api/v2/chat',
    data: { model: 'Qwen3.7', messages: [{ role: 'user', content: '你好' }] },
  });

  assert.deepEqual(records.find((record) => record.event === 'response').data, { output: 'Qwen 的最终回答' });
});

test('简洁模式会先解压 gzip SSE 再记录输出', async () => {
  const records = [];
  const compressed = gzipSync(Buffer.from('data: {"choices":[{"delta":{"content":"压缩响应"}}]}\n\ndata: [DONE]\n\n'));
  const client = createClient({
    records,
    mode: 'compact',
    response: { status: 200, headers: { 'content-encoding': 'gzip' }, data: Readable.from([compressed]) },
  });
  const result = await client.request({ method: 'POST', url: 'https://qwen.test/chat', data: { model: 'Qwen3.7', prompt: '测试' } });
  for await (const chunk of result.data) void chunk;

  assert.deepEqual(records.find((record) => record.event === 'response').data, { output: '压缩响应' });
});
