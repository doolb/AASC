const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createChat2ApiDataStore } = require('./chat2api-data-store');

const makeTempDir = async () => fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat2api-store-'));

test('账号凭据保存后只返回脱敏数据，并使用私有权限', async () => {
  const rootDir = await makeTempDir();
  const store = createChat2ApiDataStore({ rootDir });

  await store.saveAccount({
    accountId: 'deepseek-main',
    providerId: 'deepseek',
    label: '主账号',
    email: 'user@example.com',
    accessToken: 'access-secret',
    refreshToken: 'refresh-secret',
    cookie: 'cookie-secret',
    enabled: true,
  });

  const accounts = await store.listAccounts();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].accountId, 'deepseek-main');
  assert.equal(accounts[0].secretConfigured, true);
  assert.equal('accessToken' in accounts[0], false);
  assert.equal('refreshToken' in accounts[0], false);
  assert.equal('cookie' in accounts[0], false);
  assert.equal((await store.getAccount('deepseek-main')).accessToken, 'access-secret');

  const rootStat = await fs.stat(rootDir);
  const accountFile = path.join(rootDir, 'accounts.json');
  const accountStat = await fs.stat(accountFile);
  const raw = await fs.readFile(accountFile, 'utf8');
  assert.equal(rootStat.mode & 0o777, 0o700);
  assert.equal(accountStat.mode & 0o777, 0o600);
  assert.match(raw, /access-secret/);
  assert.doesNotMatch(JSON.stringify(accounts), /access-secret/);
  assert.equal((await fs.readdir(rootDir)).some((name) => name.includes('.tmp-')), false);
});

test('API Key 只在创建时返回完整值，校验结果不泄露密钥', async () => {
  const rootDir = await makeTempDir();
  const store = createChat2ApiDataStore({ rootDir });

  const created = await store.createApiKey({ label: '控制端代理' });
  assert.match(created.value, /^aasc_chat2api_/);
  assert.match(created.maskedValue, /^aasc_chat2api_.+\*{4}$/);
  assert.equal('hash' in created, false);

  const listed = await store.listApiKeys();
  assert.equal(listed.length, 1);
  assert.equal('value' in listed[0], false);
  assert.equal(listed[0].maskedValue, created.maskedValue);

  const matched = await store.validateApiKey(created.value);
  assert.equal(matched.id, created.id);
  assert.equal('value' in matched, false);
  assert.equal(await store.validateApiKey('aasc_chat2api_invalid'), null);
});

test('导入先预览，未确认时不写入，确认后合并数据', async () => {
  const rootDir = await makeTempDir();
  const store = createChat2ApiDataStore({ rootDir });
  const payload = {
    version: 1,
    providers: [{ providerId: 'kimi', name: 'Kimi' }],
    accounts: [{
      accountId: 'kimi-main',
      providerId: 'kimi',
      cookie: 'import-cookie',
      enabled: true,
    }],
    modelMappings: [{ model: 'kimi-latest', providerId: 'kimi' }],
  };

  const preview = await store.previewImport(payload);
  assert.deepEqual(preview.counts, { providers: 1, accounts: 1, modelMappings: 1 });
  assert.equal((await store.listAccounts()).length, 0);
  await assert.rejects(() => store.mergeImport(payload, false), /确认/);
  assert.equal((await store.listAccounts()).length, 0);

  const result = await store.mergeImport(payload, true);
  assert.deepEqual(result.counts, { providers: 1, accounts: 1, modelMappings: 1 });
  assert.equal((await store.listAccounts()).length, 1);
  assert.equal((await store.readCollection('providers', [])).length, 1);
  assert.equal((await store.readCollection('modelMappings', [])).length, 1);
});

test('OAuth 临时会话一次性消费并按 Provider 绑定', async () => {
  const rootDir = await makeTempDir();
  const store = createChat2ApiDataStore({ rootDir });
  const session = await store.createOAuthSession({ providerId: 'deepseek', loginUrl: 'https://chat.deepseek.com', ttlMs: 60_000 });
  assert.equal(session.providerId, 'deepseek');
  assert.equal((await store.consumeOAuthSession(session.state, 'kimi')), null);
  const consumed = await store.consumeOAuthSession(session.state, 'deepseek');
  assert.equal(consumed.loginUrl, 'https://chat.deepseek.com');
  assert.equal(await store.consumeOAuthSession(session.state, 'deepseek'), null);
  assert.equal((await fs.readdir(path.join(rootDir, 'oauth-sessions'))).length, 0);
});
