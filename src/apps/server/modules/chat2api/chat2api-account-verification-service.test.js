const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createChat2ApiDataStore, ACCOUNT_EXPORT_FORMAT } = require('./chat2api-data-store');
const { createChat2ApiProviderRegistry } = require('./chat2api-provider-registry');
const { createChat2ApiAccountVerificationService } = require('./chat2api-account-verification-service');
const cookie = 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789';
const account = { accountId: 'test-doubao', providerId: 'doubaochat', credentials: { cookie }, accountInfo: { credentialVerification: 'conversation-list' } };

const fixture = async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat2api-verify-test-'));
  t.after(async () => {
    assert.ok(path.resolve(rootDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(rootDir).startsWith('chat2api-verify-test-'));
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  const store = createChat2ApiDataStore({ rootDir });
  await store.saveAccount(account);
  return { store, registry: createChat2ApiProviderRegistry({ dataStore: store }) };
};

test('指定豆包账号复验仅更新安全元数据，失败撤销旧成功标记', async t => {
  const { store, registry } = await fixture(t);
  let verified = true;
  const service = createChat2ApiAccountVerificationService({ dataStore: store, providerRegistry: registry,
    verifier: { verify: async () => ({ verified, checkedAt: '2026-10-14T01:00:00.000Z', errorCode: 'risk' }) } });
  const success = await service.verifyAccount(account.accountId);
  assert.equal(success.account.accountInfo.credentialVerification, 'conversation-list');
  verified = false;
  const failed = await service.verifyAccount(account.accountId);
  assert.equal(failed.account.accountInfo.credentialVerification, 'format-only');
  assert.equal(failed.account.accountInfo.credentialVerificationError, 'risk');
  assert.doesNotMatch(JSON.stringify(failed), /mock_session|credentialRevision|credentialVersion/);
  await assert.rejects(service.verifyAccount('missing'), { statusCode: 404 });
  await store.saveAccount({ accountId: 'qwen-test', providerId: 'qwen', credentials: { ticket: 'fictional' } });
  await assert.rejects(service.verifyAccount('qwen-test'), { statusCode: 422 });
});

test('换凭据、导入或删除重建时旧验证结果不写回，并拒绝同账号并发复验', async t => {
  const { store, registry } = await fixture(t);
  for (const action of ['credentials', 'delete', 'bundle', 'configuration']) {
    await store.saveAccount(account);
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const service = createChat2ApiAccountVerificationService({ dataStore: store, providerRegistry: registry,
      verifier: { verify: async () => { entered(); return new Promise(resolve => { release = resolve; }); } } });
    const pending = service.verifyAccount(account.accountId);
    await started;
    await assert.rejects(service.verifyAccount(account.accountId), { statusCode: 409 });
    if (action === 'credentials') await store.updateAccount(account.accountId, { credentials: { cookie: cookie.replace('mock_session', 'new_session') } });
    if (action === 'delete') { await store.deleteAccount(account.accountId); await store.saveAccount({ ...account, accountInfo: {} }); }
    if (action === 'bundle') {
      const data = { format: ACCOUNT_EXPORT_FORMAT, version: 1, accounts: [account] };
      const preview = await store.previewAccountImport(data);
      await store.mergeAccountImport(data, preview.confirmation, true);
    }
    if (action === 'configuration') await store.mergeImport({ version: 1, accounts: [account] }, true);
    release({ verified: true, checkedAt: '2026-10-14T01:00:00.000Z' });
    await assert.rejects(pending, { statusCode: 409 });
    assert.equal((await store.getAccount(account.accountId)).accountInfo.credentialVerification, 'format-only');
  }
});

test('一般账号编辑不能伪造验证状态，同目录不同store的并发写入不丢账号', async t => {
  const { store } = await fixture(t);
  const sibling = createChat2ApiDataStore({ rootDir: store.rootDir });
  await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? sibling : store).saveAccount({ ...account, accountId: `test-${i}` })));
  assert.equal((await store.listAccounts()).length, 9);
  await store.updateAccount(account.accountId, { accountInfo: { credentialVerification: 'conversation-list', credentialVerificationError: 'Cookie=secret' } });
  const result = (await store.listAccounts()).find(item => item.accountId === account.accountId);
  assert.doesNotMatch(JSON.stringify(result), /Cookie=secret|credentialRevision/);
  // 普通编辑保留原验证，不允许用公开patch推进或伪造检查时间。
  await store.updateAccount(account.accountId, { credentials: { cookie: cookie.replace('mock_session', 'other_session') }, accountInfo: { credentialVerification: 'conversation-list' } });
  assert.equal((await store.getAccount(account.accountId)).accountInfo.credentialVerification, 'format-only');
});

test('正式原生回调经本地管理HTTP、OAuth、验证器和存储入列表，403仍保存，已有账号可复验', async t => {
  const { store } = await fixture(t);
  const { createChat2ApiRuntime } = require('./chat2api-runtime');
  const vm = require('node:vm');
  let calls = 0, upstreamSuccess = false;
  const runtime = createChat2ApiRuntime({ dataStore: store, host: '127.0.0.1', port: 0,
    httpClient: { request: async () => {
      calls++;
      return upstreamSuccess ? { status: 200, data: JSON.stringify({ status_code: 0, cmd: 3200,
        downlink_body: { pull_recent_conv_chain_downlink_body: { cells: [] } } }) } : { status: 403, data: 'private-upstream-error' };
    } },
  });
  await runtime.start();
  t.after(() => runtime.stop());
  const context = { window: {}, document: { getElementById: () => null }, fetch };
  vm.runInNewContext(await fs.readFile(path.resolve(__dirname, '../../../web-mediacenter/ui/public/js/chat2api.js'), 'utf8'), context);
  const control = context.window.Chat2APIControl;
  control.baseUrl = `http://127.0.0.1:${runtime.proxy.address().port}`;
  control.loginSession = await control.request('/api/chat2api/oauth/start', { method: 'POST', body: JSON.stringify({ providerId: 'doubaochat' }) });
  let listed;
  const messages = [];
  control.render = data => { listed = data.accounts; };
  control.message = text => messages.push(text);
  await control.completeNativeLogin({ ...control.loginSession, success: true, credentials: { cookie } });
  assert.equal(calls, 1);
  assert.equal(control.loginSession, null);
  const added = listed.find(item => item.accountId !== account.accountId);
  assert.ok(added);
  assert.equal(added.accountInfo.credentialVerification, 'format-only');
  assert.equal(added.accountInfo.credentialVerificationError, 'risk');
  assert.doesNotMatch(JSON.stringify(listed), /mock_session|private-upstream-error|credentialRevision/);
  upstreamSuccess = true;
  await control.verifyAccount(added.accountId);
  assert.equal(calls, 2);
  assert.equal(listed.find(item => item.accountId === added.accountId).accountInfo.credentialVerification, 'conversation-list');
  assert.match(messages.at(-1), /会话列表访问已验证/);
});
