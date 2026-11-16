'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../src/server');

function get(server, pathname) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    http.get({ hostname: '127.0.0.1', port: address.port, path: pathname }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(data) }));
    }).on('error', reject);
  });
}

test('serves standard CDP discovery through the shared HTTP server', async () => {
  const server = createServer({
    registry: { list: () => [], getBusinessSnapshot: () => null },
    browsers: { list: () => [], require: () => ({}) },
    tasks: { get: () => null },
    cdpProxy: {
      discovery: async (browserId, kind) => kind === 'version'
        ? { Browser: 'Chrome/130', webSocketDebuggerUrl: `/cdp/${browserId}/devtools/browser/session` }
        : [{ id: 'target-1', webSocketDebuggerUrl: `/cdp/${browserId}/devtools/page/target-1` }]
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const version = await get(server, '/cdp/main/json/version');
    assert.equal(version.status, 200);
    assert.equal(version.body.Browser, 'Chrome/130');
    const list = await get(server, '/cdp/main/json/list');
    assert.equal(list.body[0].id, 'target-1');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
