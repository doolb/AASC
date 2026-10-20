'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createDoubaoAndroidBridge } = require('./chat2api-doubao-android-bridge');

test('Android 网页桥按账号身份发送固定官网请求并逐块返回 SSE', async () => {
  let request;
  const bridge = createDoubaoAndroidBridge({ port: 19092, token: 'f'.repeat(64), accountId: 'one',
    fetchClient: async (url, options) => {
      request = { url, options };
      return { ok: true, body: Readable.from([
        '{"type":"response","status":200,"headers":{"content-type":"text/event-stream"}}\n',
        '{"type":"chunk","chunk":"event: SSE_ACK\\ndata: {}\\n\\n"}\n',
        '{"type":"end"}\n',
      ].map(item => Buffer.from(item))) };
    } });
  const response = await bridge.request({ account: { accountId: 'one', providerId: 'doubaochat',
    credentials: { cookie: `sessionid=${'s'.repeat(32)}` } },
  prepared: { url: 'https://www.doubao.com/chat/completion?aid=1', data: { messages: [] } } });
  let body = '';
  for await (const chunk of response.data) body += chunk.toString();
  assert.equal(response.status, 200);
  assert.match(body, /SSE_ACK/u);
  assert.equal(request.url, 'http://127.0.0.1:19092/fetch');
  assert.equal(JSON.parse(request.options.body).sessionId, 's'.repeat(32));
  assert.equal(JSON.parse(request.options.body).maxBytes, 8 * 1024 * 1024);
  assert.equal(request.options.headers.Authorization, `Bearer ${'f'.repeat(64)}`);
  await bridge.stop();
});

test('Android 网页桥拒绝跨来源 URL 与账号错配', async () => {
  const bridge = createDoubaoAndroidBridge({ port: 19092, token: 'f'.repeat(64), accountId: 'one',
    fetchClient: async () => { throw new Error('不应联网'); } });
  const account = { accountId: 'one', providerId: 'doubaochat',
    credentials: { cookie: `sessionid=${'s'.repeat(32)}` } };
  await assert.rejects(() => bridge.request({ account,
    prepared: { url: 'https://example.test/chat/completion', data: {} } }),
  { code: 'doubao_browser_invalid_url' });
  await assert.rejects(() => bridge.request({ account: { ...account, accountId: 'two' },
    prepared: { url: 'https://www.doubao.com/chat/completion', data: {} } }),
  { code: 'doubao_android_account' });
});
