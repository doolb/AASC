'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHttpApi } = require('../src/http-api');

function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({ hostname: '127.0.0.1', port: address.port, method, path, headers: body === undefined ? {} : { 'content-type': 'application/json' } }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.end(JSON.stringify(body)); else req.end();
  });
}

function fixtures() {
  const tasks = new Map();
  const tab = { businessId: 'media', subBusinessId: 'pornhub', targetId: 'target-1', url: 'about:blank' };
  const business = { businessId: 'media', browserId: 'main', windowId: 'window-1', queue: {
    enqueue(operation) {
      const taskId = `task-${tasks.size + 1}`;
      const done = Promise.resolve().then(operation);
      tasks.set(taskId, done.then(result => ({ taskId, status: 'succeeded', result })));
      return { taskId, done };
    }
  } };
  const registry = {
    list: () => [{ businessId: 'media', browserId: 'main', state: 'not-created', tabs: [] }],
    ensureBusiness: async () => business,
    ensureSubBusiness: async () => tab,
    getBusinessSnapshot: id => id === 'media' ? ({ ...business, tabs: [tab] }) : null,
    activateSubBusiness: () => business.queue.enqueue(() => 'activated'),
    get: () => business,
    close: async () => {}
  };
  const browsers = {
    list: () => [{ id: 'main', state: 'disconnected' }],
    ensure: async () => ({ status: () => ({ id: 'main', state: 'connected' }) }),
    require: () => ({ status: () => ({ id: 'main', state: 'connected' }) })
  };
  return { registry, browsers, tasks };
}

test('serves status, validates unknown routes, and returns structured errors', async () => {
  const fixturesValue = fixtures();
  const server = createHttpApi(fixturesValue);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const status = await request(server, 'GET', '/api/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.ok, true);
    const missing = await request(server, 'GET', '/api/businesses/missing');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'BUSINESS_NOT_FOUND');
    const invalid = await request(server, 'POST', '/api/businesses/media/sub-businesses/x/action', { action: 'unknown' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'INVALID_ACTION');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('ensures a tab and returns task IDs for navigation and activation', async () => {
  const server = createHttpApi(fixtures());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const ensured = await request(server, 'POST', '/api/businesses/media/sub-businesses/pornhub/ensure', {});
    assert.equal(ensured.status, 200);
    assert.equal(ensured.body.targetId, 'target-1');
    const navigation = await request(server, 'POST', '/api/businesses/media/sub-businesses/pornhub/navigate', { url: 'https://example.test' });
    assert.equal(navigation.status, 202);
    assert.match(navigation.body.taskId, /^task-/);
    const activation = await request(server, 'POST', '/api/businesses/media/sub-businesses/pornhub/activate', {});
    assert.equal(activation.status, 202);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('rejects oversized JSON requests', async () => {
  const server = createHttpApi(fixtures(), { maxBodyBytes: 20 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await request(server, 'POST', '/api/businesses/media/sub-businesses/x/navigate', { url: 'https://example.test/a-long-url' });
    assert.equal(result.status, 413);
    assert.equal(result.body.error.code, 'REQUEST_TOO_LARGE');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
