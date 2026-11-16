'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BrowserInstance } = require('../src/browser-instance');
const { BrowserRegistry } = require('../src/browser-registry');

function childProcess() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.kill = signal => { child.killSignal = signal; child.exitCode = 0; child.emit('exit', 0); };
  return child;
}

function browserConnection(version = { Browser: 'Chrome/130', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/x' }) {
  const browser = new EventEmitter();
  browser.connected = true;
  browser.version = async () => version.Browser;
  browser.wsEndpoint = () => version.webSocketDebuggerUrl;
  browser.disconnect = () => { browser.connected = false; browser.emit('disconnected'); };
  return browser;
}

test('attaches to an existing compatible browser without spawning or owning it', async () => {
  const attached = browserConnection({ Browser: 'Vivaldi/6.9', webSocketDebuggerUrl: 'ws://existing' });
  let spawned = false;
  const instance = new BrowserInstance({ id: 'main', browser: 'vivaldi', debugPort: 9222, probe: async () => ({ Browser: 'Vivaldi/6.9' }), attach: async () => attached, spawn: () => { spawned = true; } });
  const result = await instance.ensure();

  assert.equal(result, attached);
  assert.equal(instance.owned, false);
  assert.equal(spawned, false);
  await instance.close();
  assert.equal(attached.connected, false);
});

test('starts Chromium with configured launch arguments and persistent profile', async () => {
  const child = childProcess();
  let args;
  let options;
  let probes = 0;
  const attached = browserConnection();
  const instance = new BrowserInstance({
    id: 'media', browser: 'chromium', debugPort: 9334, display: ':0', profile: '/profiles/media',
    portAvailable: async () => true,
    spawn: (...values) => { args = values[1]; options = values[2]; return child; },
    probe: async () => (++probes > 1 ? { Browser: 'Chrome/130' } : null),
    attach: async () => attached,
    sleep: async () => {}
  });
  await instance.ensure();

  assert.equal(instance.owned, true);
  assert.deepEqual(args, [
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9334',
    '--no-first-run', '--no-default-browser-check', '--display=:0',
    '--user-data-dir=/profiles/media'
  ]);
  assert.equal(options.env.DISPLAY, ':0');
  await instance.close();
  assert.equal(child.killSignal, 'SIGTERM');
});

test('deduplicates concurrent ensure calls and rejects a type mismatch', async () => {
  let attaches = 0;
  const attached = browserConnection({ Browser: 'Chrome/130' });
  const instance = new BrowserInstance({ id: 'main', browser: 'vivaldi', debugPort: 9222, probe: async () => ({ Browser: 'Firefox/130' }), attach: async () => { attaches++; await new Promise(r => setTimeout(r, 5)); return attached; } });
  await assert.rejects(() => instance.ensure(), /browser type|Vivaldi|mismatch/i);
  assert.equal(attaches, 0);

  const valid = new BrowserInstance({ id: 'main', browser: 'chromium', debugPort: 9222, probe: async () => ({ Browser: 'Chrome/130' }), attach: async () => { attaches++; return attached; } });
  assert.equal((await Promise.all([valid.ensure(), valid.ensure()])).length, 2);
  assert.equal(attaches, 1);
});

test('registry reuses one instance and rejects profile conflicts', () => {
  const registry = new BrowserRegistry({ browsers: {
    first: { browser: 'chromium', debugPort: 9222, profile: '/tmp/shared' },
    second: { browser: 'chromium', debugPort: 9333, profile: '/tmp/shared' }
  } });
  assert.equal(registry.get('first'), registry.get('first'));
  assert.throws(() => registry.validate(), /profile/i);
});
