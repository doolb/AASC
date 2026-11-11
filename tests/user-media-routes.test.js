'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerUserMediaRoutes } = require('../src/apps/server/modules/media/user-media-routes');

test('油猴跨域采集必须持有有效凭据', async t => {
  const app = express(); app.use(express.json()); let writes = 0;
  registerUserMediaRoutes(app, { getToken: () => 'a'.repeat(64), service: { async save() { writes++; return { count: 1 }; } } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/user-media/capture`;
  const send = authorization => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com', ...(authorization ? { authorization } : {}) }, body: '{}' });
  assert.equal((await send()).status, 403);
  assert.equal((await send('Bearer ' + 'é'.repeat(64))).status, 403);
  assert.equal((await send('Bearer ' + 'b'.repeat(64))).status, 403);
  const response = await send('Bearer ' + 'a'.repeat(64));
  assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(writes, 1);
});
