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
  assert.equal((await store.disableApiKey(created.id)).enabled, false);
  assert.equal(await store.validateApiKey(created.value), null);
  assert.equal(await store.deleteApiKey(created.id), true);
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

test('配置导出按原值保留账号凭据和持久化配置，但不导出 API Key', async () => {
  const sourceRootDir = await makeTempDir();
  const source = createChat2ApiDataStore({ rootDir: sourceRootDir });
  const account = {
    accountId: 'deepseek-main',
    providerId: 'deepseek',
    label: '主账号',
    credentials: { token: 'token-secret', cookie: 'cookie-secret' },
    enabled: false,
    metadata: { region: 'cn' },
  };
  const config = { host: '0.0.0.0', port: 9090, enableApiKey: true };
  const provider = { providerId: 'custom', id: 'custom', name: 'Custom', apiEndpoint: 'https://example.com/api' };
  const mapping = { model: 'custom-chat', actualModel: 'custom-v1', providerId: 'custom' };
  await source.writeCollection('config', config);
  await source.writeCollection('providers', [provider]);
  await source.writeCollection('accounts', [account]);
  await source.writeCollection('modelMappings', [mapping]);
  const apiKey = await source.createApiKey({ label: '不应导出' });

  const exported = await source.exportConfiguration();
  assert.deepEqual(exported.config, config);
  assert.deepEqual(exported.providers, [provider]);
  assert.deepEqual(exported.accounts, [account]);
  assert.deepEqual(exported.modelMappings, [mapping]);
  assert.equal(exported.format, 'aasc-chat2api-config');
  assert.equal(exported.version, 1);
  assert.equal('apiKeys' in exported, false);
  assert.doesNotMatch(JSON.stringify(exported), new RegExp(apiKey.value));

  const target = createChat2ApiDataStore({ rootDir: await makeTempDir() });
  await target.mergeImport(exported, true);
  assert.deepEqual(await target.readCollection('config', {}), config);
  assert.deepEqual(await target.getAccount('deepseek-main'), account);
});

test('账号凭证独立导出只包含账号，并按 ID 预览确认合并', async () => {
  const sourceRootDir = await makeTempDir();
  const source = createChat2ApiDataStore({ rootDir: sourceRootDir });
  const sourceAccount = {
    accountId: 'legacy-account',
    providerId: 'qwen',
    label: '旧账号',
    email: 'legacy@example.com',
    credentials: { ticket: 'ticket-secret' },
    metadata: { shouldNotExport: true },
    enabled: true,
  };
  await source.writeCollection('config', { host: '0.0.0.0' });
  await source.writeCollection('providers', [{ providerId: 'qwen', name: 'Qwen' }]);
  await source.writeCollection('modelMappings', [{ model: 'qwen', actualModel: 'qwen-v1' }]);
  await source.saveAccount(sourceAccount);
  const apiKey = await source.createApiKey({ label: '不应导出' });

  const exported = await source.exportAccountCredentials();
  assert.equal(exported.format, 'aasc-chat2api-accounts');
  assert.equal(exported.version, 1);
  assert.equal(exported.accounts.length, 1);
  assert.equal(exported.accounts[0].accountId, 'legacy-account');
  assert.equal(exported.accounts[0].credentials.ticket, 'ticket-secret');
  assert.equal('metadata' in exported.accounts[0], false);
  assert.equal('config' in exported, false);
  assert.equal('providers' in exported, false);
  assert.equal('modelMappings' in exported, false);
  assert.equal('apiKeys' in exported, false);
  assert.doesNotMatch(JSON.stringify(exported), new RegExp(apiKey.value));

  const target = createChat2ApiDataStore({ rootDir: await makeTempDir() });
  await target.writeCollection('providers', [{ providerId: 'qwen', name: 'Qwen' }]);
  await target.saveAccount({ accountId: 'legacy-account', providerId: 'qwen', label: '本地旧账号', credentials: { ticket: 'old' } });
  await target.saveAccount({ accountId: 'keep-account', providerId: 'qwen', credentials: { ticket: 'keep' } });
  const payload = {
    format: 'aasc-chat2api-accounts',
    version: 1,
    accounts: [
      { accountId: 'legacy-account', providerId: 'qwen', label: '更新后的旧账号', credentials: { ticket: 'new' } },
      { providerId: 'qwen', email: ' New@Example.com ', credentials: { ticket: 'new-account' } },
    ],
  };
  const preview = await target.previewAccountImport(payload);
  assert.deepEqual(preview.counts, { new: 1, update: 1, invalid: 0 });
  assert.equal(preview.items[0].action, 'update');
  assert.equal(preview.items[1].accountId, 'qwen:new@example.com');
  assert.doesNotMatch(JSON.stringify(preview), /new-account|old/);
  await assert.rejects(() => target.mergeAccountImport(payload, 'wrong', true), /确认摘要/);
  const result = await target.mergeAccountImport(payload, preview.confirmation, true);
  assert.deepEqual(result.counts, { new: 1, update: 1, invalid: 0 });
  assert.equal((await target.getAccount('legacy-account')).credentials.ticket, 'new');
  assert.equal((await target.getAccount('qwen:new@example.com')).credentials.ticket, 'new-account');
  assert.equal((await target.getAccount('keep-account')).credentials.ticket, 'keep');
});

test('账号凭证导入拒绝同一文件内重复 accountId', async () => {
  const store = createChat2ApiDataStore({ rootDir: await makeTempDir() });
  await assert.rejects(() => store.previewAccountImport({
    format: 'aasc-chat2api-accounts',
    version: 1,
    accounts: [
      { accountId: 'same', providerId: 'qwen', credentials: { ticket: 'a' } },
      { accountId: 'same', providerId: 'qwen', credentials: { ticket: 'b' } },
    ],
}), /重复/);
});

test('账号凭证预览确认可稳定合并没有邮箱或手机号的新账号', async () => {
  const store = createChat2ApiDataStore({ rootDir: await makeTempDir() });
  await store.writeCollection('providers', [{ providerId: 'qwen', name: 'Qwen' }]);
  const payload = {
    format: 'aasc-chat2api-accounts',
    version: 1,
    accounts: [{ providerId: 'qwen', credentials: { ticket: 'secret' } }],
  };
  const preview = await store.previewAccountImport(payload);
  const result = await store.mergeAccountImport(payload, preview.confirmation, true);
  assert.equal(result.counts.new, 1);
  assert.match(result.accounts[0].accountId, /^qwen-[a-f0-9]{12}$/);
});

test('一键迁移原 Chat2API data.json，并保留配置与账号凭据', async () => {
  const rootDir = await makeTempDir();
  const legacyDataPath = path.join(rootDir, 'legacy', 'data.json');
  await fs.mkdir(path.dirname(legacyDataPath), { recursive: true });
  await fs.writeFile(legacyDataPath, JSON.stringify({
    providers: [{ id: 'qwen', name: 'Qwen', apiEndpoint: 'https://chat2.qianwen.com', modelMappings: { Qwen: 'Qwen' } }],
    accounts: [{ id: 'legacy-account', providerId: 'qwen', name: '原账号', credentials: { ticket: 'legacy-ticket' }, status: 'active' }],
    config: {
      proxyHost: '127.0.0.1', proxyPort: 8090, loadBalanceStrategy: 'fill-first', enableApiKey: false,
      modelMappings: { 'qwen-request': { requestModel: 'qwen-request', actualModel: 'Qwen', preferredProviderId: 'qwen' } },
    },
    userModelOverrides: {
      qwen: {
        addedModels: [{ displayName: 'Qwen3.6-Flash', actualModelId: 'Qwen3.7' }],
      },
    },
  }), 'utf8');
  const store = createChat2ApiDataStore({ rootDir, legacyDataPath });

  const preview = await store.previewLegacyImport();
  assert.deepEqual(preview.counts, { providers: 1, accounts: 1, modelMappings: 2 });
  assert.equal(preview.config.port, 8090);
  assert.doesNotMatch(JSON.stringify(preview), /legacy-ticket/);
  assert.equal((await store.listAccounts()).length, 0);

  await assert.rejects(() => store.mergeLegacyImport(false), /确认/);
  const result = await store.mergeLegacyImport(true);
  assert.deepEqual(result.counts, { providers: 1, accounts: 1, modelMappings: 2 });
  assert.equal((await store.getAccount('legacy-account')).credentials.ticket, 'legacy-ticket');
  assert.equal((await store.readCollection('config', {})).port, 8090);
  assert.equal((await store.readCollection('config', {})).loadBalanceStrategy, 'fill-first');
  assert.deepEqual(
    (await store.readCollection('modelMappings', [])).find((mapping) => mapping.model === 'Qwen3.6-Flash'),
    { model: 'Qwen3.6-Flash', actualModel: 'Qwen3.7', providerId: 'qwen' },
  );
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

test('账号和模型映射支持更新与删除', async () => {
  const rootDir = await makeTempDir();
  const store = createChat2ApiDataStore({ rootDir });
  await store.saveAccount({ accountId: 'a1', providerId: 'deepseek', credentials: { token: 'secret' }, enabled: true });
  assert.equal((await store.updateAccount('a1', { enabled: false, label: '停用账号' })).enabled, false);
  assert.equal(await store.deleteAccount('a1'), true);
  await store.saveModelMapping({ model: 'chat', actualModel: 'deepseek-v4-flash', providerId: 'deepseek' });
  assert.equal((await store.listModelMappings()).length, 1);
  assert.equal(await store.deleteModelMapping('chat'), true);
});
