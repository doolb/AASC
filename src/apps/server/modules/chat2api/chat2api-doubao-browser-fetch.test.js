'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchInDoubaoPage, validateCompletionUrl } = require('./chat2api-doubao-browser-fetch');

const mockPage = packets => {
  let callback;
  let aborted = false;
  return {
    exposeFunction: async (name, handler) => { callback = handler; },
    evaluate: async (fn, input) => {
      if (typeof input === 'string') { aborted = true; return; }
      for (const packet of packets) await callback({ requestId: input.requestId, ...packet });
    },
    wasAborted: () => aborted,
  };
};

test('只接受豆包官网固定聊天路径', () => {
  assert.equal(validateCompletionUrl('https://www.doubao.com/chat/completion?aid=1').pathname, '/chat/completion');
  for (const url of ['https://evil.example/chat/completion', 'https://www.doubao.com/chat/other',
    'https://www.doubao.com@evil.example/chat/completion']) {
    assert.throws(() => validateCompletionUrl(url), { code: 'doubao_browser_invalid_url' });
  }
});

test('页面按请求 ID 回传 SSE，完整流由调用方读取', async () => {
  const page = mockPage([
    { type: 'response', status: 200, headers: { 'content-type': 'text/event-stream' } },
    { type: 'chunk', chunk: 'event: SSE_ACK\ndata: {}\n\n' },
    { type: 'end' },
  ]);
  const response = await fetchInDoubaoPage({ page, url: 'https://www.doubao.com/chat/completion?aid=1',
    payload: { messages: [{ content: '早' }] } });
  let received = '';
  for await (const chunk of response.data) received += chunk.toString();
  assert.equal(response.status, 200);
  assert.match(received, /SSE_ACK/u);
});

test('超过响应上限时中止流，取消信号可到达页面', async () => {
  const page = mockPage([{ type: 'response', status: 200, headers: {} },
    { type: 'chunk', chunk: '123456' }]);
  const response = await fetchInDoubaoPage({ page, url: 'https://www.doubao.com/chat/completion',
    payload: {}, maxBytes: 4 });
  await assert.rejects(async () => { for await (const chunk of response.data) void chunk; },
    { code: 'doubao_browser_limit' });
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(fetchInDoubaoPage({ page, url: 'https://www.doubao.com/chat/completion',
    payload: {}, signal: cancelled.signal }), { code: 'doubao_browser_cancelled' });
});
