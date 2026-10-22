'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { createDoubaoBrowserBridge } = require('./chat2api-doubao-browser-bridge');

test('媒体临时官网页在流结束后关闭，聊天页可按会话复用', async () => {
  const pages = [];
  const browser = { newPage: async () => {
    const page = { closed: false, isClosed() { return this.closed; },
      goto: async () => {}, evaluateOnNewDocument: async () => {}, url: () => 'https://www.doubao.com/chat/',
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

test('官网同时有www与父域sessionid时，以www账号身份核对', async () => {
  const browser = { newPage: async () => ({
    isClosed: () => false, goto: async () => {}, evaluateOnNewDocument: async () => {}, url: () => 'https://www.doubao.com/chat/',
    createCDPSession: async () => ({ send: async () => ({ cookies: [
      { name: 'sessionid', domain: 'www.doubao.com', value: 'www-session-1234567890123456' },
      { name: 'sessionid', domain: '.doubao.com', value: 'domain-session-1234567890123456' },
    ] }), detach: async () => {} }),
    waitForFunction: async () => true,
  }) };
  const bridge = createDoubaoBrowserBridge({ getConfig: () => ({ mode: 'browser-fetch' }),
    launcher: { open: async () => browser, close: async () => {} },
    fetchPage: async () => {
      const data = new PassThrough();
      queueMicrotask(() => data.end('done'));
      return { status: 200, data };
    } });
  const prepared = { url: 'https://www.doubao.com/chat/completion', data: {} };
  const account = { providerId: 'doubaochat', accountId: 'one',
    credentials: { cookie: 'sessionid=www-session-1234567890123456' } };
  const response = await bridge.request({ account, prepared });
  for await (const _ of response.data) { /* 消费测试流。 */ }
  await assert.rejects(bridge.request({ account: { ...account,
    credentials: { cookie: 'sessionid=domain-session-1234567890123456' } }, prepared }),
  { code: 'doubao_browser_auth' });
  await bridge.stop();
});

test('停止期间等待中的浏览器启动不能迟到创建页面，停止后拒绝继续操作', async () => {
  let release, entered, pages = 0, closes = 0;
  const starting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const bridge = createDoubaoBrowserBridge({ getConfig: () => ({ mode: 'browser-fetch' }),
    launcher: { open: async () => { entered(); await gate; return { newPage: async () => { pages += 1; } }; },
      close: async () => { closes += 1; } } });
  const options = { account: { accountId: 'one', providerId: 'doubaochat', credentials: {} },
    prepared: { url: 'https://www.doubao.com/chat/completion', data: {} } };
  const pending = bridge.request(options);
  const rejected = assert.rejects(pending, { code: 'doubao_browser_disabled' });
  await starting;
  const stopped = bridge.stop();
  release(); await stopped; await rejected;
  assert.equal(pages, 0); assert.equal(closes, 1);
  await assert.rejects(bridge.request(options), { code: 'doubao_browser_disabled' });
});

test('共享浏览器运行页清理保留登录Context，登录期间拒绝切换宿主账号', async () => {
  const main = {}, login = {};
  const page = context => ({ closed: false, browserContext: () => context, isClosed() { return this.closed; },
    url: () => 'https://www.doubao.com/chat/', close: async function () { this.closed = true; },
    goto: async () => {}, evaluateOnNewDocument: async () => {}, waitForFunction: async () => true,
    createCDPSession: async () => ({ send: async () => ({ cookies: [{ name: 'sessionid', domain: 'www.doubao.com', value: 'session' }] }), detach: async () => {} }) });
  const runtimePage = page(main), loginPage = page(login);
  const browser = { defaultBrowserContext: () => main, pages: async () => [loginPage, runtimePage] };
  const bridge = createDoubaoBrowserBridge({ getConfig: () => ({}), launcher: { open: async () => browser, close: async () => {} },
    fetchPage: async () => { const data = new PassThrough(); queueMicrotask(() => data.end('ok')); return { data }; } });
  const lease = await bridge.openLogin({ accountId: 'one' });
  const options = { account: { accountId: 'one', providerId: 'doubaochat', credentials: { cookie: 'sessionid=session' } }, prepared: { url: 'https://www.doubao.com/chat/completion', data: {} } };
  const response = await bridge.request(options);
  for await (const _ of response.data) { /* 同账号正常完成运行请求。 */ }
  assert.equal(loginPage.closed, false);
  await assert.rejects(bridge.request({ ...options, account: { ...options.account, accountId: 'two' } }), { code: 'doubao_browser_busy' });
  await lease.release(); assert.equal(bridge.isBusy(), false);
  await bridge.stop();
  assert.equal(loginPage.closed, false);
});
