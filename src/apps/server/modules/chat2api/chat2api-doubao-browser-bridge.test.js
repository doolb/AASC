'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { createDoubaoBrowserBridge } = require('./chat2api-doubao-browser-bridge');

test('媒体临时官网页在流结束后关闭，聊天页可按会话复用', async () => {
  const pages = [];
  const browser = { newPage: async () => {
    const page = { closed: false, isClosed() { return this.closed; },
      goto: async () => {}, url: () => 'https://www.doubao.com/chat/',
      createCDPSession: async () => ({ send: async () => ({ cookies: [
        { name: 'sessionid', domain: '.doubao.com', value: 'session-1234567890123456' },
      ] }), detach: async () => {} }),
      waitForFunction: async () => true, close: async function close() { this.closed = true; },
    };
    pages.push(page);
    return page;
  } };
  const bridge = createDoubaoBrowserBridge({ getConfig: () => ({ mode: 'browser-fetch', accountId: 'one' }),
    launcher: { open: async () => browser, close: async () => {} },
    fetchPage: async () => {
      const data = new PassThrough();
      queueMicrotask(() => data.end('done'));
      return { status: 200, data };
    } });
  const account = { providerId: 'doubaochat', accountId: 'one',
    credentials: { cookie: 'sessionid=session-1234567890123456' } };
  const prepared = { url: 'https://www.doubao.com/chat/completion', data: {} };
  const media = await bridge.request({ account, sessionKey: 'media-1', prepared, ephemeral: true });
  for await (const chunk of media.data) assert.equal(chunk.toString(), 'done');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pages[0].closed, true);
  const chatA = await bridge.request({ account, sessionKey: 'chat-1', prepared });
  for await (const _ of chatA.data) { /* 消费流以释放 busy 标记。 */ }
  const chatB = await bridge.request({ account, sessionKey: 'chat-1', prepared });
  for await (const _ of chatB.data) { /* 第二轮沿用同一官网页。 */ }
  assert.equal(pages.length, 2);
  assert.equal(pages[1].closed, false);
  await bridge.stop();
});
