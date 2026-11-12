'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createBrowserMediaService, normalizeOrigins, proxyArgument } = require('../src/apps/server/modules/media/browser-media-service');

function browserFactory(records) {
  return async options => {
    const record = { options, closed: 0, requests: 0, state: 'ready', url: 'about:blank', handlers: {} }; records.push(record);
    const page = {
      url: () => record.url, isClosed: () => false, mainFrame: () => page,
      async setRequestInterception() {}, on: (event, fn) => { record.handlers[event] = fn; },
      async goto(url) { record.url = url; return { status: () => 200 }; },
      async bringToFront() { record.focused = true; },
      async evaluate(fn, argument) {
        const document = { title: record.state === 'challenge' ? 'Just a moment...' : '示例',
          querySelector: selector => selector.includes('og:title') ? { content: '示例视频' } : null,
          querySelectorAll: selector => selector.startsWith('video,') ? [{ currentSrc: 'https://cdn.example.com/one.mp4', title: '第一集', closest: () => null }] : [] };
        const context = { document, URL, location: { href: record.url }, performance: { getEntriesByType: () => [] }, Map, Uint8Array, TextDecoder, AbortController, setTimeout, clearTimeout, btoa,
          fetch: async () => { record.requests++; let read = false; return { status: 200, headers: { get: () => 'text/plain' }, body: { getReader: () => ({ read: async () => read ? { done: true } : (read = true, { done: false, value: Buffer.from('ok') }) }) } }; } };
        return vm.runInNewContext(`(${fn.toString()})`, context)(argument);
      }
    };
    record.page = page;
    return { pages: async () => [page], on() {}, close: async () => { record.closed++; } };
  };
}

test('浏览器服务按来源隔离、访问受限并运行现有采集脚本', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-browser-media-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const records = [];
  const service = createBrowserMediaService({ rootDir: root, allowedOrigins: 'https://example.com', launch: browserFactory(records), resolveBrowser: async () => '/test/vivaldi' });
  const first = { sourceId: 'source-a', pageUrl: 'https://example.com/watch' };
  const result = await service.extract(first);
  assert.equal(result.content, '示例视频'); assert.equal(result.items[0].title, '第一集');
  assert.equal(result.items[0].url, 'https://cdn.example.com/one.mp4');
  let decision = '';
  records[0].handlers.request({ isNavigationRequest: () => true, frame: () => records[0].page, url: () => 'https://outside.example/', abort: async () => { decision = 'blocked'; }, continue: async () => { decision = 'allowed'; } });
  assert.equal(decision, 'blocked');
  assert.equal((await service.request({ ...first, url: 'https://example.com/api' })).body, 'ok');
  const binary = await service.request({ ...first, url: 'https://example.com/api', responseType: 'binary', range: 'bytes=0-1' });
  assert.equal(binary.body.toString(), 'ok');
  await assert.rejects(service.request({ ...first, range: 'bytes=0-1,3-4' }), /Range/);
  await service.open({ sourceId: 'source-b', pageUrl: first.pageUrl, proxyUrl: 'http://proxy.example:8080' });
  assert.equal(records.length, 2);
  assert.notEqual(records[0].options.userDataDir, records[1].options.userDataDir);
  assert.ok(records[1].options.args.includes('--proxy-server=http://proxy.example:8080'));
  await service.showPage(); assert.equal(records[1].focused, true);
  await assert.rejects(service.request({ ...first, url: 'https://other.example/api' }), /同源/);
  await assert.rejects(service.open({ sourceId: 'source-a', pageUrl: 'https://other.example/' }), { code: 'BROWSER_MEDIA_ORIGIN' });
  await assert.rejects(service.open({ ...first, proxyUrl: 'http://user:pass@proxy.example:8080' }), /无凭据/);
  await service.stop();
  assert.deepEqual(records.map(record => record.closed), [1, 1]);
  await assert.rejects(service.request(first), { code: 'BROWSER_MEDIA_DISABLED' });
});

test('挑战页保留供人工处理，验证后继续请求', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-browser-challenge-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const records = [];
  const launch = browserFactory(records);
  const service = createBrowserMediaService({ rootDir: root, allowedOrigins: ['https://example.com'], resolveBrowser: async () => '/test/vivaldi', launch: async options => { const browser = await launch(options); records[0].state = 'challenge'; return browser; } });
  const options = { sourceId: 'sample', pageUrl: 'https://example.com/' };
  await assert.rejects(service.open(options), { code: 'BROWSER_MEDIA_CHALLENGE' });
  assert.equal(service.status().sessions[0].state, 'challenge');
  await service.showPage(); records[0].state = 'ready';
  assert.equal((await service.request(options)).body, 'ok');
  await service.stop();
});

test('白名单和代理规范化拒绝不受支持的配置', () => {
  assert.deepEqual(normalizeOrigins('https://example.com/a,https://example.com/b'), ['https://example.com']);
  assert.throws(() => normalizeOrigins('http://example.com/'), /HTTPS/);
  assert.equal(proxyArgument('socks5h://example.com:1080'), 'socks5://example.com:1080');
  assert.throws(() => proxyArgument('socks5h://user:pass@example.com:1080'), /无凭据/);
});

test('专用页面被用户关闭后，下次请求创建新浏览器', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-browser-closed-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const records = [];
  const service = createBrowserMediaService({ rootDir: root, allowedOrigins: ['https://example.com'], launch: browserFactory(records), resolveBrowser: async () => '/test/vivaldi' });
  const options = { sourceId: 'sample', pageUrl: 'https://example.com/' };
  await service.open(options);
  records[0].handlers.close();
  await service.open(options);
  assert.equal(records.length, 2);
  assert.equal(records[0].closed, 1);
  await service.stop();
});

test('空允许列表允许不同 HTTPS 网站，但会话仍限制同源请求与导航', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-browser-all-sites-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const records = [];
  const service = createBrowserMediaService({ rootDir: root, allowedOrigins: '', launch: browserFactory(records), resolveBrowser: async () => '/test/vivaldi' });
  t.after(() => service.stop());
  const first = { sourceId: 'source-a', pageUrl: 'https://first.example/watch' };
  const second = { sourceId: 'source-b', pageUrl: 'https://second.example/' };
  assert.equal((await service.request(first)).body, 'ok');
  assert.equal((await service.request(second)).body, 'ok');
  assert.equal(records.length, 2);
  await assert.rejects(service.request({ ...first, url: 'https://second.example/api' }), /同源/);
  await assert.rejects(service.open({ ...first, pageUrl: 'http://first.example/' }), /HTTPS/);
  await assert.rejects(service.open({ ...first, pageUrl: 'https://user:pass@first.example/' }), /HTTPS/);
  let decision = '';
  records[0].handlers.request({ isNavigationRequest: () => true, frame: () => records[0].page, url: () => 'https://second.example/', abort: async () => { decision = 'blocked'; }, continue: async () => { decision = 'allowed'; } });
  assert.equal(decision, 'blocked');
});
