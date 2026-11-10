'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
const { run } = require('../res/tasks/domestic-media/task');
const { client } = require('../res/tasks/domestic-media/providers/http');

async function withProviders(callback, stopHook = async () => {}) {
  const load = Module._load;
  let stops = 0;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.endsWith('/res/tasks/domestic-media/task.js')) {
      if (request === './providers/hongguo') return { createHongguoProvider: (config, options) => ({ config, options }) };
      if (request === './providers/tomato') return { createTomatoProvider: () => ({ create: config => ({ config }), stop: async () => { stops++; await stopHook(stops); } }) };
    }
    return load.apply(this, arguments);
  };
  try { await callback(() => stops); } finally { Module._load = load; }
}
function context(registry) {
  return { params: { hongguoCookie: 'private-cookie' }, log() {}, registerMediaProvider: definition => registry.register('new-task', definition) };
}

test('国内任务注册两个真实注册表条目并停止注销', async () => withProviders(async getStops => {
  const registry = new TaskMediaProviderRegistry();
  const service = await run(context(registry));
  assert.deepEqual(registry.list().map(item => item.id), ['hongguo', 'tomato']);
  for (const entry of registry.list()) {
    assert.equal(entry.region, 'domestic');
    assert.equal(entry.proxyDefault, false);
    assert.deepEqual(entry.features, ['home', 'search', 'resolveLink', 'related', 'stream', 'download']);
  }
  assert.equal(registry.get('hongguo').create({}).options.cookie, 'private-cookie');
  await service.stop(); await service.stop();
  assert.deepEqual(registry.list(), []);
  assert.equal(getStops(), 1);
}));

test('旧红果注册不被覆盖，番茄冲突撤销本次红果并停止资源', async () => withProviders(async getStops => {
  const registry = new TaskMediaProviderRegistry();
  const old = { id: 'hongguo', name: '旧红果', create: () => ({}) };
  const removeOld = registry.register('old', old);
  await assert.rejects(run(context(registry)), /先停止.*旧任务/);
  assert.equal(registry.get('hongguo').owner, 'old');
  removeOld();
  registry.register('other', { id: 'tomato', create: () => ({}) });
  await assert.rejects(run(context(registry)), /先停止.*旧任务/);
  assert.equal(registry.get('hongguo'), undefined);
  assert.equal(registry.get('tomato').owner, 'other');
  assert.equal(getStops(), 1);
}));

test('停止清理失败后可重试，并发调用只执行一次清理', async () => withProviders(async getStops => {
  const registry = new TaskMediaProviderRegistry();
  const service = await run(context(registry));
  const first = await Promise.allSettled([service.stop(), service.stop()]);
  assert.deepEqual(first.map(result => result.status), ['rejected', 'rejected']);
  assert.deepEqual(registry.list(), []);
  assert.equal(getStops(), 1);
  await Promise.all([service.stop(), service.stop()]);
  await service.stop();
  assert.equal(getStops(), 2);
}, async count => { if (count === 1) throw new Error('模拟清理失败'); }));

test('请求逐次读取当前代理并在直连时禁用环境代理', async () => {
  let selected = '';
  const seen = [];
  const config = { get proxyUrl() { return selected; } };
  const request = client(config, { adapter: async options => {
    seen.push(options);
    return { data: '', status: 200, statusText: 'OK', headers: {}, config: options };
  } });
  await request.get('http://example.test');
  selected = 'http://user:secret@localhost:8888';
  await request.get('http://example.test');
  selected = '';
  await request.get('http://example.test');
  assert.deepEqual(seen.map(item => item.proxy), [false, false, false]);
  assert.equal(seen[0].httpAgent, undefined);
  assert.ok(seen[1].httpAgent);
  assert.equal(seen[2].httpAgent, undefined);
  selected = 'http://user:secret@localhost:8888/?secret=yes';
  await assert.rejects(request.get('http://example.test'), error => !error.message.includes('secret'));
});

test('红果清理失败仍停止番茄，并只重试失败实例', async () => {
  const load = Module._load; let hongguoStops = 0, tomatoStops = 0;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.endsWith('/res/tasks/domestic-media/task.js')) {
      if (request === './providers/hongguo') return { createHongguoProvider: () => ({ stop: async () => { if (++hongguoStops === 1) throw new Error('private'); } }) };
      if (request === './providers/tomato') return { createTomatoProvider: () => ({ create: () => ({}), stop: async () => { tomatoStops++; } }) };
    }
    return load.apply(this, arguments);
  };
  try {
    const registry = new TaskMediaProviderRegistry(); const service = await run(context(registry));
    registry.get('hongguo').create({});
    await assert.rejects(service.stop(), error => !error.message.includes('private'));
    assert.equal(tomatoStops, 1); assert.equal(hongguoStops, 1);
    await service.stop(); assert.equal(hongguoStops, 2); assert.equal(tomatoStops, 1);
  } finally { Module._load = load; }
});
