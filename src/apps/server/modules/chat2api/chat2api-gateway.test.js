const assert = require('assert/strict');
const http = require('http');
const test = require('node:test');

const { createChat2ApiGateway } = require('./chat2api-gateway');

const request = (port, options, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, ...options }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { text += chunk; });
    res.on('end', () => resolve({ statusCode: res.statusCode, text }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

test('同源网关按运行中的 chat2api 实例转发管理请求', async () => {
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ path: req.url, method: req.method, body: body ? JSON.parse(body) : null }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const port = upstream.address().port;
  const gateway = createChat2ApiGateway({
    taskManager: { getInstanceStatus: async () => ({ taskName: 'chat2api.proxy', status: 'running', params: { port } }) },
  });
  const server = http.createServer((req, res) => {
    req.params = { instanceId: 'instance-1' };
    req.body = req.method === 'POST' ? { confirmed: true } : undefined;
    req.resume();
    gateway(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server.address().port, { path: '/api/chat2api/import/legacy/merge', method: 'POST' }, JSON.stringify({ confirmed: true }));
    assert.equal(response.statusCode, 200, response.text);
    assert.deepEqual(JSON.parse(response.text), { path: '/api/chat2api/import/legacy/merge', method: 'POST', body: { confirmed: true } });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('同源网关拒绝未运行实例和非 Chat2API 路径', async () => {
  const gateway = createChat2ApiGateway({ taskManager: { getInstanceStatus: async () => ({ status: 'stopped', params: { port: 1 } }) } });
  const server = http.createServer((req, res) => {
    req.params = { instanceId: 'instance-1' };
    req.resume();
    gateway(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server.address().port, { path: '/api/chat2api/config', method: 'GET' });
    assert.equal(response.statusCode, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
