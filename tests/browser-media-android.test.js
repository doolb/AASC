'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAndroidBrowserAdapter } = require('../src/apps/server/modules/media/browser-media-android');

test('Android 适配器使用本机令牌桥创建、操作和关闭页面', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const command = JSON.parse(options.body);
    calls.push({ url, auth: options.headers.authorization, command });
    return { ok: true, json: async () => ({ ok: true, value: command.operation === 'evaluate' ? 42 : true }) };
  };
  const adapter = createAndroidBrowserAdapter({ port: 19093, token: 'x'.repeat(64), fetchImpl });
  const browser = await adapter.launch();
  const [page] = await browser.pages();
  await page.goto('https://example.com/');
  assert.equal(page.url(), 'https://example.com/');
  assert.equal(await page.evaluate(value => value + 1, 41), 42);
  await page.bringToFront();
  await browser.close(); await browser.close();
  assert.deepEqual(calls.map(call => call.command.operation), ['reset', 'create', 'navigate', 'evaluate', 'select', 'close']);
  assert.ok(calls.every(call => call.url === 'http://127.0.0.1:19093/command' && call.auth === `Bearer ${'x'.repeat(64)}`));
  assert.ok(calls.slice(1).every(call => call.command.id === calls[1].command.id));
});

test('Android 适配器拒绝无效端点并报告操作失败', async () => {
  assert.throws(() => createAndroidBrowserAdapter({ port: 19093, token: '' }), /不可用/);
  const operations = [];
  const adapter = createAndroidBrowserAdapter({ port: 19093, token: 'x'.repeat(64), fetchImpl: async (_url, options) => {
    operations.push(JSON.parse(options.body).operation);
    const operation = JSON.parse(options.body).operation;
    return operation === 'reset' ? { ok: true, json: async () => ({ ok: true, value: true }) } : { ok: false, json: async () => ({ error: '失败' }) };
  } });
  await assert.rejects(adapter.launch(), /失败/);
  assert.deepEqual(operations, ['reset', 'create', 'close']);
});
