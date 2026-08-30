const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createChat2ApiDataStore } = require('./chat2api-data-store');
const { createChat2ApiResponseSessionStore } = require('./chat2api-response-session-store');

const makeTempDir = async () => fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat2api-response-'));

test('Responses 会话可持久化并按 responseId 查找', async () => {
  const rootDir = await makeTempDir();
  const dataStore = createChat2ApiDataStore({ rootDir });
  const store = createChat2ApiResponseSessionStore({ dataStore });
  const session = await store.create({
    conversationId: 'conv_test',
    providerId: 'qwen',
    accountId: 'qwen-main',
    actualModel: 'Qwen3.7',
    history: [{ role: 'user', content: '你好' }],
    nativeState: { sessionId: 'qwen-session' },
    latestResponseId: 'resp_test',
  });

  assert.equal(session.conversationId, 'conv_test');
  assert.equal((await store.get('conv_test')).nativeState.sessionId, 'qwen-session');
  assert.equal((await store.findByResponseId('resp_test')).conversationId, 'conv_test');
  await store.save({ ...session, latestResponseId: 'resp_test_2', responseIds: ['resp_test', 'resp_test_2'] });
  assert.equal((await store.findByResponseId('resp_test')).conversationId, 'conv_test');
  const file = path.join(rootDir, 'responses-sessions.json');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('同一 Responses 会话的状态更新按顺序执行，不阻塞不同会话', async () => {
  const rootDir = await makeTempDir();
  const dataStore = createChat2ApiDataStore({ rootDir });
  const store = createChat2ApiResponseSessionStore({ dataStore });
  const events = [];
  const first = store.withLock('conv_a', async () => {
    events.push('a:start');
    await new Promise((resolve) => setTimeout(resolve, 20));
    events.push('a:end');
  });
  const second = store.withLock('conv_a', async () => events.push('a2'));
  const other = store.withLock('conv_b', async () => events.push('b'));
  await Promise.all([first, second, other]);

  assert.deepEqual(events, ['a:start', 'b', 'a:end', 'a2']);
});
