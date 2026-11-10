'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
const { run } = require('../res/tasks/overseas-media/task');
const { client } = require('../res/tasks/overseas-media/providers/http');

async function withProviders(callback, stopHook = async () => {}) {
  const original = Module._load;
  const created = [];
  let stops = 0;
  const make = (config, options) => ({ config, options, list() {}, getFile() {}, getFileStream() {} });
  Module._load = function (request, parent) {
    if (parent?.filename.endsWith('/res/tasks/overseas-media/task.js')) {
      if (request === './providers/youtube') return { createYoutubeProvider: make };
      if (request === './providers/pinterest') return { createPinterestProvider: make };
      if (request === './providers/pixiv') return { createPixivProvider: make };
      if (request === './providers/ytdlp') return { createYtdlp: options => {
        created.push(options);
        return { stop: async () => { stops++; await stopHook(stops); } };
      } };
    }
    return original.apply(this, arguments);
  };
  try { await callback(created, () => stops); } finally { Module._load = original; }
}
function context(registry) {
  return { params: { youtubeCookie: 'private-cookie' }, workDir: '/tmp/task', log() {}, registerMediaProvider: definition => registry.register('new-task', definition) };
}
test('真实注册表接收三个国外来源，动态代理传递到独立 YouTube 工具', async () => withProviders(async (created, getStops) => {
  const registry = new TaskMediaProviderRegistry();
  const service = await run(context(registry));
  assert.deepEqual(registry.list().map(item => item.id), ['youtube', 'pinterest', 'pixiv']);
  for (const entry of registry.list()) {
    assert.equal(entry.region, 'overseas'); assert.equal(entry.proxyDefault, true);
    assert.deepEqual(entry.features, ['home', 'search', 'resolveLink', 'related', 'stream', 'download']);
    assert.ok(!JSON.stringify(entry).includes('private-cookie'));
  }
  let selected = '';
  const config = { get proxyUrl() { return selected; } };
  const provider = registry.get('youtube').create(config);
  assert.equal(provider.options.cookie, 'private-cookie');
  assert.equal(created[0].proxyUrl(), '');
  selected = 'http://user:secret@localhost:8888';
  assert.equal(created[0].proxyUrl(), selected);
  await Promise.all([service.stop(), service.stop()]); await service.stop();
  assert.deepEqual(registry.list(), []); assert.equal(getStops(), 1);
}));
test('来源冲突时回滚本次注册并保留旧任务', async () => withProviders(async () => {
  const registry = new TaskMediaProviderRegistry();
  registry.register('old', { id: 'pixiv', create: () => ({}) });
  await assert.rejects(run(context(registry)), /先停止.*旧任务/);
  assert.deepEqual(registry.list().map(item => item.id), ['pixiv']);
  assert.equal(registry.get('pixiv').owner, 'old');
}));
test('停止失败后可重试且错误不暴露凭据', async () => withProviders(async (created, getStops) => {
  const registry = new TaskMediaProviderRegistry(); const service = await run(context(registry));
  registry.get('youtube').create({});
  const results = await Promise.allSettled([service.stop(), service.stop()]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
  assert.ok(results.every(result => !result.reason.message.includes('secret')));
  assert.deepEqual(registry.list(), []); assert.equal(getStops(), 1);
  await service.stop(); assert.equal(getStops(), 2);
}, async count => { if (count === 1) throw new Error('secret'); }));
test('一个资源清理失败不会阻止其他资源清理，重试只处理失败资源', async () => withProviders(async (created, getStops) => {
  const registry = new TaskMediaProviderRegistry(); const service = await run(context(registry));
  registry.get('youtube').create({}); registry.get('youtube').create({});
  await assert.rejects(service.stop(), /停止失败/);
  assert.equal(getStops(), 2);
  assert.deepEqual(registry.list(), []);
  await service.stop();
  await service.stop();
  assert.equal(getStops(), 3);
}, async count => { if (count === 1) throw new Error('清理失败'); }));
test('HTTP 每次读取代理，直连禁用环境代理，非法地址不泄露凭据', async () => {
  let selected = ''; const seen = [];
  const request = client({ get proxyUrl() { return selected; } }, { adapter: async options => {
    seen.push(options); return { data: '', status: 200, statusText: 'OK', headers: {}, config: options };
  } });
  await request.get('http://example.test'); selected = 'http://user:secret@localhost:8888';
  await request.get('http://example.test'); selected = ''; await request.get('http://example.test');
  assert.deepEqual(seen.map(item => item.proxy), [false, false, false]);
  assert.equal(seen[0].httpAgent, undefined); assert.ok(seen[1].httpAgent); assert.equal(seen[2].httpAgent, undefined);
  selected = 'http://user:secret@localhost:8888/?secret=yes';
  await assert.rejects(request.get('http://example.test'), error => !error.message.includes('secret'));
});
