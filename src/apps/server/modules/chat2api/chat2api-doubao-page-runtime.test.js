'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { PAGE_BOOTSTRAP_SOURCE, executeDoubaoPageRequest, createPageExecutionScript,
  acceptPreparedRequest } = require('./chat2api-doubao-page-runtime');
const { acquireDoubaoBrowserPort } = require('./chat2api-doubao-browser-port');

const makePage = (fetcher = async () => new Response('早上好')) => {
  const packets = [], calls = [];
  const context = vm.createContext({ Request, Response, Headers, URL, AbortController, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, Map, Uint8Array, FormData, Blob, atob, crypto: globalThis.crypto,
    location: { href: 'https://www.doubao.com/chat/', origin: 'https://www.doubao.com' },
    navigator: { userAgent: 'Mozilla/5.0 shared-test' }, document: { cookie: '' },
    performance: { getEntriesByType: () => [{ name: 'https://evil.test/path?device_id=evil&pc_version=evil' },
      { name: 'https://www.doubao.com/api?pc_version=3.42.1&device_id=not-the-account' }] },
    fetch: async (url, options) => { calls.push({ url, options }); return fetcher(url, options); },
    AASCDoubaoRuntime: { onPacket: raw => packets.push(JSON.parse(raw)) },
    callback: packet => packets.push(JSON.parse(JSON.stringify(packet))),
  });
  context.window = context;
  vm.runInContext(PAGE_BOOTSTRAP_SOURCE, context);
  const bottom = context.fetch;
  context.fetch = (url, options) => bottom(url + '&a_bogus=sdk-current', options);
  context.bdms = { frontierSign: () => ({ 'X-Bogus': 'sdk-frontier' }) };
  return { context, packets, calls };
};
const input = overrides => ({ requestId: 'one', inputUrl: 'https://www.doubao.com/chat/completion?aid=1&device_id=123',
  body: { option: { unique_key: 'unique' }, messages: ['早'] }, bodyType: 'json',
  contentType: 'application/json', method: 'POST', bridgeName: 'callback', maxBytes: 1000, ...overrides });

test('CDP函数与Android执行脚本使用同一业务，UTF8流和结束事件一致', async () => {
  for (const platform of ['desktop', 'android']) {
    const page = makePage();
    if (platform === 'desktop') {
      page.context.arg = input();
      await vm.runInContext(`(${executeDoubaoPageRequest.toString()})(arg)`, page.context);
    } else await vm.runInContext(createPageExecutionScript(input()), page.context);
    assert.deepEqual(page.packets.map(p => p.type), ['response', 'chunk', 'end']);
    assert.equal(page.packets[1].chunk, '早上好');
    const url = new URL(page.calls[0].url, 'https://www.doubao.com');
    assert.equal(url.searchParams.get('pc_version'), '3.42.1');
    assert.equal(url.searchParams.get('device_id'), '123');
    assert.equal(url.searchParams.get('a_bogus'), 'sdk-current');
  }
});

test('两端共享prepare只取得SDK处理后参数，绝不把准备变成实际发送', async () => {
  const page = makePage();
  await vm.runInContext(createPageExecutionScript(input({ prepareOnly: true })), page.context);
  assert.equal(page.calls.length, 0);
  assert.deepEqual(page.packets.map(p => p.type), ['prepared', 'end']);
  assert.match(page.packets[0].url, /a_bogus=sdk-current/u);
  assert.equal(page.packets[0].headers['user-agent'], 'Mozilla/5.0 shared-test');
  assert.equal(page.packets[0].headers.cookie, undefined);
});

test('共享页面验证来源、按UTF8字节限制及传播取消', async () => {
  const foreign = makePage();
  await vm.runInContext(createPageExecutionScript(input({ inputUrl: 'https://evil.test/chat/completion' })), foreign.context);
  assert.equal(foreign.calls.length, 0);
  assert.equal(foreign.packets.at(-1).type, 'error');
  const limited = makePage();
  await vm.runInContext(createPageExecutionScript(input({ maxBytes: 4 })), limited.context);
  assert.deepEqual(limited.packets.map(p => p.type), ['response', 'error']);
  assert.equal(limited.packets.at(-1).code, 'response_too_large');
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const cancelled = makePage((_url, options) => new Promise((_resolve, reject) => {
    started(); options.signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true });
  }));
  const run = vm.runInContext(createPageExecutionScript(input()), cancelled.context);
  await entered;
  vm.runInContext('window.__aascDoubaoAborts.one.abort()', cancelled.context);
  await run;
  assert.equal(cancelled.packets.at(-1).code, 'cancelled');
});

test('签名回执不允许改变设备、加入Cookie或换正文，合法结果共用本轮消息', () => {
  const prepared = { url: 'https://www.doubao.com/chat/completion?aid=1&device_id=123',
    headers: { Cookie: 'private' }, data: { message: '早' } };
  const packet = { url: prepared.url + '&a_bogus=fresh', headers: { origin: 'https://www.doubao.com',
    'user-agent': 'Mozilla/5.0 shared-test' } };
  const result = acceptPreparedRequest(prepared, packet, 'Mozilla/5.0 shared-test');
  assert.equal(result.data, prepared.data);
  assert.equal(result.headers.Cookie, 'private');
  for (const changed of [{ ...packet, url: packet.url.replace('device_id=123', 'device_id=999') },
    { ...packet, headers: { ...packet.headers, cookie: 'untrusted' } }]) {
    assert.throws(() => acceptPreparedRequest(prepared, changed, 'Mozilla/5.0 shared-test'));
  }
});

test('任务和代理共用一个平台桥，最后租约释放才关闭，重新借用等待关闭完成', async () => {
  let created = 0, stopped = 0, unblock;
  const closed = new Promise(resolve => { unblock = resolve; });
  const rootDir = '/tmp/aasc-port-contract-' + process.pid;
  const factory = getConfig => { created += 1; return {
    prepare: async () => getConfig().debugPort,
    request: async () => 200,
    stop: async () => { stopped += 1; if (stopped === 1) await closed; },
  }; };
  const a = acquireDoubaoBrowserPort({ rootDir, factory, android: false });
  const b = acquireDoubaoBrowserPort({ rootDir, factory, android: false, config: { debugPort: 9324 } });
  assert.equal(await a.prepare({}), 9324);
  await a.stop(); await a.stop();
  assert.equal(await b.request({}), 200); assert.equal(created, 1); assert.equal(stopped, 0);
  const releasing = b.stop();
  const c = acquireDoubaoBrowserPort({ rootDir, factory, android: false });
  const next = c.prepare({});
  unblock(); await releasing;
  assert.equal(await next, 9324); assert.equal(created, 2);
  await c.stop(); assert.equal(stopped, 2);
});

test('原生Cookie只允许同账号，不能更换登录身份或注入换行', () => {
  const { withBrowserCookie } = require('./chat2api-doubao-page-runtime');
  const credentials = { cookie: 'sessionid=expected_session_value' };
  const request = { headers: {} };
  assert.equal(withBrowserCookie(request, 'sessionid=expected_session_value; ttwid=current', credentials)
    .headers.Cookie, 'sessionid=expected_session_value; ttwid=current');
  for (const cookie of ['sessionid=another_session', 'sessionid=expected_session_value\r\nx=bad']) {
    assert.throws(() => withBrowserCookie(request, cookie, credentials));
  }
});
