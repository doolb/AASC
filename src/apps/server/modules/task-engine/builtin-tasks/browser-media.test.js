'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const registry = require('./registry');
const task = require('./browser-media');
const { browserMedia } = require('../../media/browser-media-registry');

test('桌面任务注册浏览器接口、扫描保存并在停止后注销', async () => {
  assert.equal(registry.getTask('browser.media'), task);
  const actions = new Map(), updates = [], saved = [];
  let stopped = 0, opened = 0, focused = 0;
  const service = { open: async () => { opened++; }, request: async () => ({ status: 200 }), extract: async () => ({}),
    extractCurrent: async () => ({ sourceUrl: 'https://example.com/', items: [{ url: 'https://cdn.example.com/1.mp4' }] }),
    showPage: async () => { focused++; }, status: () => ({ running: true, sessions: [] }), stop: async () => { stopped++; } };
  const runner = await task.run({ params: { allowedOrigins: 'https://example.com', initialUrl: 'https://example.com/' },
    browserMediaEnvironment: { DISPLAY: ':1' }, browserMediaPlatform: 'linux', browserMediaFactory: () => service,
    onWidgetAction: (name, handler) => actions.set(name, handler), postWidgetUpdate: value => updates.push(value), saveUserMedia: async value => saved.push(value) });
  assert.equal(opened, 1); assert.equal((await browserMedia.request({})).status, 200);
  assert.equal((await actions.get('scanMedia')()).success, true); assert.equal(saved.length, 1);
  await actions.get('showPage')(); assert.equal(focused, 1);
  await runner.stop(); assert.equal(stopped, 1); assert.equal(browserMedia.status().running, false);
  assert.ok(updates.some(value => value.scanText.includes('已保存 1')));
});

test('非 Linux 和无图形环境不会启动浏览器，旧版 Android 提示缺少服务', async () => {
  for (const [platform, environment] of [['linux', {}], ['win32', { DISPLAY: ':1' }]]) {
    await assert.rejects(task.run({ browserMediaPlatform: platform, browserMediaEnvironment: environment, browserMediaHasX1: false }), /仅支持 Linux 图形桌面/);
  }
  await assert.rejects(task.run({ browserMediaPlatform: 'linux', browserMediaEnvironment: { AASC_ANDROID_NODE: '1' } }), /更新 APK/);
});

test('Android 将默认上限及独立端点交给服务，并拒绝独立代理', async () => {
  let config;
  const service = { status: () => ({ running: true, sessions: [] }), stop: async () => {} };
  const runner = await task.run({ params: {}, browserMediaEnvironment: { AASC_ANDROID_NODE: '1', AASC_BROWSER_MEDIA_PORT: '19093', AASC_BROWSER_MEDIA_TOKEN: 'a'.repeat(64) },
    browserMediaFactory: options => { config = options; return service; } });
  assert.equal(config.maxSessions, 1);
  assert.equal(config.rejectProxy, true);
  assert.equal(typeof config.launch, 'function');
  await runner.stop();
});
