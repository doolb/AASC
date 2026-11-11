'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerBrowserMediaRoutes } = require('../src/apps/server/modules/media/browser-media-routes');
const { browserMediaCall } = require('../scripts/browser-media-client');

test('浏览器业务接口校验令牌并通过脚本访问现有服务', async t => {
  const token = 'a'.repeat(64);
  let configured = '';
  const app = express();
  app.use(express.json());
  const service = {
    status: () => ({ running: true }),
    request: async options => {
      if (options.pageUrl === 'https://challenge.test/') throw Object.assign(new Error('challenge'), { code: 'BROWSER_MEDIA_CHALLENGE' });
      if (options.pageUrl === 'https://disabled.test/') throw Object.assign(new Error('disabled'), { code: 'BROWSER_MEDIA_DISABLED' });
      return { status: 206, body: Buffer.from('test'), contentRange: 'bytes 0-3/4' };
    },
    extract: async options => ({ title: '内容', items: [{ url: options.pageUrl }] })
  };
  registerBrowserMediaRoutes(app, { service, getToken: () => configured });
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(browserMediaCall({ server: address, token }), { code: 'BROWSER_MEDIA_API_DISABLED', status: 503 });
  configured = token;
  await assert.rejects(browserMediaCall({ server: address, token: 'b'.repeat(64) }), { code: 'BROWSER_MEDIA_UNAUTHORIZED', status: 403 });
  assert.deepEqual(await browserMediaCall({ server: address, token }), { running: true });
  const binary = await browserMediaCall({ server: address, token, operation: 'request', options: { sourceId: 'test', pageUrl: 'https://example.com/', responseType: 'binary' } });
  assert.equal(Buffer.from(binary.body, binary.encoding).toString(), 'test');
  assert.equal(binary.contentRange, 'bytes 0-3/4');
  const extracted = await browserMediaCall({ server: address, token, operation: 'extract', options: { sourceId: 'test', pageUrl: 'https://example.com/' } });
  assert.equal(extracted.title, '内容');
  await assert.rejects(browserMediaCall({ server: address, token, operation: 'request', options: { pageUrl: 'https://challenge.test/' } }), { code: 'BROWSER_MEDIA_CHALLENGE', status: 409 });
  await assert.rejects(browserMediaCall({ server: address, token, operation: 'request', options: { pageUrl: 'https://disabled.test/' } }), { code: 'BROWSER_MEDIA_DISABLED', status: 503 });
  await assert.rejects(browserMediaCall({ server: 'http://example.com', token }), /HTTPS/);
});
