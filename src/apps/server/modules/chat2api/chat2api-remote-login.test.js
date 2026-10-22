const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRemoteBrowserSessions, validateInput } = require('./chat2api-remote-browser-session');
const { createChat2ApiDataStore, accountLoginVersion } = require('./chat2api-data-store');

function fixture(t) {
  let clock = 1000;
  const browsers = [];
  const saved = [];
  const runtime = { getStatus: () => ({ running: true }), dataStore: { getAccount: async () => null },
    oauth: { startLogin: async () => ({ state: 'state', expiresAt: 5000 }), cancelLogin: async () => {},
      completeLogin: async value => { saved.push(value); return { account: { accountId: 'saved', secret: 'private' } }; } } };
  const manager = createRemoteBrowserSessions({ getRuntime: async () => runtime, now: () => clock,
    openBrowser: async () => { const browser = { closed: false, inputs: [], frames: 0,
      close: async () => { browser.closed = true; }, frame: async () => ({ image: String(++browser.frames) }),
      input: async value => browser.inputs.push(value), capture: async () => ({ token: 'private' }) };
    browsers.push(browser); return browser; } });
  t.after(() => manager.stop());
  const socket = () => ({ readyState: 1, messages: [], send(value) { this.messages.push(JSON.parse(value)); } });
  const a = socket(), b = socket();
  const send = async (owner, action, data = {}) => {
    await manager.handle(owner, { requestId: 'test', action, providerId: 'deepseek', instanceId: 'one', ...data });
    return owner.messages.at(-1);
  };
  return { manager, a, b, browsers, saved, send, advance: () => { clock = 6000; } };
}

test('唯一登录槽位绑定控制端，切换关闭旧页面，保存不泄露凭据', async t => {
  const f = fixture(t);
  const first = await f.send(f.a, 'open');
  assert.equal(first.success, true);
  assert.equal(first.expiresAt, 5000);
  assert.equal((await f.send(f.a, 'open')).sessionId, first.sessionId);
  assert.equal((await f.send(f.b, 'open')).success, false);
  assert.equal((await f.send(f.b, 'frame', { sessionId: first.sessionId })).success, false);
  assert.equal((await f.send(f.a, 'open', { providerId: 'glm' })).success, false);
  const second = await f.send(f.a, 'open', { providerId: 'glm', replace: true });
  assert.equal(second.success, true); assert.equal(f.browsers[0].closed, true);
  const result = await f.send(f.a, 'complete', { sessionId: second.sessionId });
  assert.equal(result.saved, true); assert.doesNotMatch(JSON.stringify(result), /private/);
  assert.equal(f.browsers[1].closed, true); assert.equal(f.saved.length, 1);
});

test('帧限频、输入序号、过期与断线释放', async t => {
  const f = fixture(t), opened = await f.send(f.a, 'open');
  const id = { sessionId: opened.sessionId };
  await f.send(f.a, 'frame', id); await f.send(f.a, 'frame', id);
  assert.equal(f.browsers[0].frames, 1);
  for (const [i, kind] of ['down', 'move', 'up'].entries()) {
    assert.equal((await f.send(f.a, 'input', { ...id, sequence: i + 1, payload: { kind, x: 20, y: 30 } })).success, true);
  }
  assert.equal((await f.send(f.a, 'input', { ...id, sequence: 3, payload: { kind: 'text', text: '中文' } })).success, false);
  f.advance(); assert.equal((await f.send(f.a, 'complete', id)).success, false);
  await f.send(f.b, 'open'); assert.equal(f.browsers[0].closed, true);
  f.manager.disconnect(f.b); await f.manager.stop();
  assert.equal(f.browsers.at(-1).closed, true);
});

test('输入边界拒绝任意命令并限制滚动与文本', () => {
  assert.throws(() => validateInput({ kind: 'down', x: NaN, y: 1 }));
  assert.throws(() => validateInput({ kind: 'key', key: 'F12' }));
  assert.throws(() => validateInput({ kind: 'text', text: 'a'.repeat(4097) }));
  assert.equal(validateInput({ kind: 'wheel', deltaX: 0, deltaY: 9999 }).deltaY, 720);
  assert.equal(validateInput({ kind: 'text', text: '你好' }).text, '你好');
});

test('通用账号版本保护其他Provider的更新，拒绝旧登录覆盖', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-login-store-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const store = createChat2ApiDataStore({ rootDir });
  await store.saveAccount({ accountId: 'a', providerId: 'deepseek', credentials: { token: 'first' } });
  const original = await store.getAccount('a');
  await store.saveAccount({ ...original, credentials: { token: 'second' } });
  await assert.rejects(store.saveAccount(original, { expectedCredentialVersion: accountLoginVersion(original) }), /凭据已变化/);
  const latest = await store.getAccount('a');
  await store.saveAccount({ ...latest, credentials: { token: 'third' } }, { expectedCredentialVersion: accountLoginVersion(latest) });
  assert.equal((await store.getAccount('a')).credentials.token, 'third');
});

test('关闭连接时仍在启动的浏览器会在启动返回后释放', async t => {
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  let closed = false;
  const owner = { readyState: 1, send() {} };
  const runtime = { getStatus: () => ({ running: true }), oauth: {
    startLogin: async () => ({ state: 'x', expiresAt: Date.now() + 5000 }), cancelLogin: async () => {} } };
  const manager = createRemoteBrowserSessions({ getRuntime: async () => runtime, openBrowser: async () => {
    began(); await wait; return { close: async () => { closed = true; } };
  } });
  t.after(() => manager.stop());
  const opening = manager.handle(owner, { action: 'open', requestId: 'x', providerId: 'deepseek' });
  await started; owner.readyState = 3; manager.disconnect(owner); release(); await opening; await manager.stop();
  assert.equal(closed, true);
});
