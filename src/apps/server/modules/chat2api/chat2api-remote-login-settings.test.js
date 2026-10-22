const test = require('node:test');
const assert = require('node:assert/strict');
const { createRemoteLoginSettings } = require('./chat2api-remote-login-settings');
const { createRemoteBrowserSessions } = require('./chat2api-remote-browser-session');

test('帧率WS配置默认10，校验边界，持久化广播，拒绝非控制端及保存失败回退', () => {
  let stored, fail = false;
  const replies = [], broadcasts = [];
  const control = { send: value => replies.push(JSON.parse(value)) };
  const config = { get: () => stored, set: (key, value) => {
    assert.equal(key, 'chat2api.remoteLogin'); if (fail) return false; stored = value; return true;
  } };
  const settings = createRemoteLoginSettings({ config, broadcast: value => broadcasts.push(value), isControl: socket => socket === control });
  assert.equal(settings.get().fps, 10);
  settings.handle({}, { type: 'setChat2ApiRemoteLoginConfig', fps: 30 }); assert.equal(stored, undefined);
  for (const fps of [1, 30, 10]) settings.handle(control, { type: 'setChat2ApiRemoteLoginConfig', fps });
  assert.deepEqual(broadcasts.map(value => value.fps), [1, 30, 10]);
  for (const fps of [0, 31, 2.5, NaN, '20', null]) {
    settings.handle(control, { type: 'setChat2ApiRemoteLoginConfig', fps });
    assert.equal(replies.at(-1).success, false); assert.equal(replies.at(-1).fps, 10);
  }
  fail = true; settings.handle(control, { type: 'setChat2ApiRemoteLoginConfig', fps: 20 });
  assert.equal(replies.at(-1).fps, 10); assert.equal(broadcasts.length, 3);
  settings.handle(control, { type: 'getChat2ApiRemoteLoginConfig', requestId: 'reconnect' });
  assert.equal(replies.at(-1).requestId, 'reconnect'); assert.equal(replies.at(-1).fps, 10);
  assert.equal(createRemoteLoginSettings({ config, broadcast() {}, isControl() {} }).get().fps, 10);
});

test('服务端按截图开始时间动态限频，慢截图不叠加固定等待', async t => {
  let now = 1000, fps = 10, frames = 0;
  const replies = [];
  const owner = { readyState: 1, send: value => replies.push(JSON.parse(value)) };
  const manager = createRemoteBrowserSessions({ now: () => now, getFrameSettings: () => ({ fps }),
    getRuntime: async () => ({ getStatus: () => ({ running: true }), oauth: { startLogin: async () => ({ state: 's' }), cancelLogin: async () => {} } }),
    openBrowser: async () => ({ close: async () => {}, frame: async () => { frames++; now += 60; return { image: 'frame' }; } }) });
  t.after(() => manager.stop());
  await manager.handle(owner, { action: 'open', requestId: 'open', providerId: 'deepseek' });
  const sessionId = replies.at(-1).sessionId;
  const frame = () => manager.handle(owner, { action: 'frame', requestId: 'frame', sessionId });
  await frame(); await frame(); assert.equal(frames, 1);
  now = 1100; await frame(); assert.equal(frames, 2);
  fps = 1; now = 1500; await frame(); assert.equal(frames, 2);
  fps = 30; await frame(); assert.equal(frames, 3);
});
