const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createChat2ApiRuntime } = require('./chat2api-runtime');

test('runtime与默认语音适配器使用注入的上游队列，失败在建连前返回且不惩罚账号', async t => {
  // 对应.src/framework/tts-provider-configuration.md：验证装配确实传到真实默认适配器，不创建网络连接。
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat2api-upstream-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let admissions = 0;
  const runtime = createChat2ApiRuntime({ rootDir, doubaoSpeechQueue: { acquire(accountId) {
    admissions++; assert.equal(accountId, 'one');
    throw Object.assign(new Error('等待队满'), { code: 'doubao_speech_busy', speechQueueFailure: true });
  } } });
  t.after(() => runtime.stop());
  await runtime.dataStore.saveAccount({ accountId: 'one', providerId: 'doubaochat',
    credentials: { cookie: 'sessionid=demo_session_12345678; passport_csrf_token=demo_csrf_12345678' } });
  const failures = [];
  runtime.loadBalancer.markAccountFailed = accountId => failures.push(accountId);
  await assert.rejects(runtime.speechService.generate({ model: 'doubao-chat', input: '不联网的队列验证' }), e => e.code === 'doubao_speech_busy');
  assert.equal(admissions, 1);
  const account = await runtime.dataStore.getAccount('one');
  assert.notEqual(account.enabled, false);
  assert.deepEqual(failures, []);
});

test('Chat2API runtime 共享数据层并可启动/停止代理服务', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat2api-runtime-'));
  const runtime = createChat2ApiRuntime({ rootDir, host: '127.0.0.1', port: 0, enableApiKey: false });
  await runtime.start();
  assert.equal(runtime.proxy.isRunning(), true);
  assert.equal(runtime.proxy.address().address, '127.0.0.1');
  await runtime.stop();
  assert.equal(runtime.proxy.isRunning(), false);
});
