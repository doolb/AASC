'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { CdpProxy } = require('../src/cdp-proxy');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.readyState = 1;
  }
  send(value) { this.sent.push(value); }
  close() { this.readyState = 3; this.emit('close'); }
}

function browserFixture() {
  const upstream = {
    version: {
      Browser: 'Chrome/130',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/native'
    },
    list: [{ id: 'target-1', type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/target-1' }],
    connect: async () => new FakeSocket()
  };
  return { id: 'main', endpoint: 'http://127.0.0.1:9222', upstream };
}

test('rewrites discovery endpoints without changing CDP fields', async () => {
  const fixture = browserFixture();
  const proxy = new CdpProxy({ browsers: { require: () => fixture }, publicOrigin: 'http://127.0.0.1:3090' });
  const version = await proxy.discovery('main', 'version');
  assert.equal(version.webSocketDebuggerUrl, 'ws://127.0.0.1:3090/cdp/main/devtools/browser/native');
  const list = await proxy.discovery('main', 'list');
  assert.equal(list[0].webSocketDebuggerUrl, 'ws://127.0.0.1:3090/cdp/main/devtools/page/target-1');
});

test('forwards page messages unchanged and uses the target queue', async () => {
  const fixture = browserFixture();
  const upstream = new FakeSocket();
  fixture.upstream.connect = async () => upstream;
  const calls = [];
  const proxy = new CdpProxy({ browsers: { require: () => fixture }, queueForTarget: async () => ({ enqueue: operation => { calls.push('queued'); return { done: operation() }; } }) });
  const client = new FakeSocket();
  await proxy.attachPage('main', 'target-1', client);
  client.emit('message', Buffer.from(JSON.stringify({ id: 7, method: 'Runtime.enable', params: { x: 1 }, sessionId: 's' })));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(upstream.sent[0]), { id: 7, method: 'Runtime.enable', params: { x: 1 }, sessionId: 's' });
  assert.deepEqual(calls, ['queued']);
  upstream.emit('message', JSON.stringify({ method: 'Runtime.executionContextCreated', params: {} }));
  assert.deepEqual(JSON.parse(client.sent[0]), { method: 'Runtime.executionContextCreated', params: {} });
});

test('closes both sockets when either side disconnects', async () => {
  const fixture = browserFixture();
  const upstream = new FakeSocket();
  fixture.upstream.connect = async () => upstream;
  const proxy = new CdpProxy({ browsers: { require: () => fixture } });
  const client = new FakeSocket();
  await proxy.attachPage('main', 'target-1', client);
  client.close();
  assert.equal(upstream.readyState, 3);
});
