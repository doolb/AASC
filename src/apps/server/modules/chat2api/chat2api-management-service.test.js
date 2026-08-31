const assert = require('assert/strict');
const test = require('node:test');

const { createChat2ApiManagementService } = require('./chat2api-management-service');

test('管理服务统一提供配置、Provider、账号、OAuth 和 API Key 接口', async () => {
  const calls = [];
  const runtime = {
    dataStore: {
      readCollection: async (name, fallback) => name === 'config' ? { port: 8080 } : fallback,
      writeCollection: async (name, value) => calls.push([name, value]),
      listAccounts: async () => [{ accountId: 'a1', providerId: 'deepseek', secretConfigured: true }],
      createApiKey: async () => ({ id: 'key-1', value: 'aasc_chat2api_secret', maskedValue: 'aasc_chat2api_****' }),
      listApiKeys: async () => [{ id: 'key-1', maskedValue: 'aasc_chat2api_****' }],
      previewImport: async (value) => ({ counts: { providers: value.providers.length } }),
      mergeImport: async (value, confirmed) => ({ confirmed, counts: { providers: value.providers.length } }),
      previewLegacyImport: async () => ({ counts: { providers: 1 } }),
      mergeLegacyImport: async (confirmed) => ({ confirmed, counts: { providers: 1 } }),
      updateAccount: async (id, patch) => ({ accountId: id, ...patch }),
      deleteAccount: async () => true,
      listModelMappings: async () => [],
      saveModelMapping: async (mapping) => mapping,
      deleteModelMapping: async () => true,
      updateApiKey: async (id, patch) => ({ id, ...patch }),
      disableApiKey: async () => ({ enabled: false }),
      deleteApiKey: async () => true,
    },
    providerRegistry: {
      listProviders: async () => [{ id: 'deepseek', name: 'DeepSeek' }],
      saveProvider: async (provider) => provider,
    },
    oauth: {
      startLogin: async (providerId) => ({ providerId, state: 'state-1', loginUrl: 'https://chat.deepseek.com' }),
      completeLogin: async (input) => ({ account: { accountId: input.accountId || 'a1', providerId: input.providerId } }),
      handleCallback: async (query) => ({ account: { providerId: query.providerId } }),
    },
  };
  const management = createChat2ApiManagementService(runtime);
  const defaultConfig = await management.getConfig();
  assert.equal(defaultConfig.port, 8080);
  assert.equal(defaultConfig.debugRawTraffic, false);
  assert.equal(defaultConfig.rawTrafficMaxBytes, 262144);
  assert.equal(defaultConfig.rawTrafficMode, 'full');
  assert.deepEqual(await management.listProviders(), [{ id: 'deepseek', name: 'DeepSeek' }]);
  assert.equal((await management.listAccounts())[0].secretConfigured, true);
  assert.equal((await management.startLogin('deepseek')).state, 'state-1');
  assert.equal((await management.createApiKey({ label: 'test' })).value, 'aasc_chat2api_secret');
  assert.equal((await management.previewLegacyImport()).counts.providers, 1);
  assert.equal((await management.mergeLegacyImport(true)).confirmed, true);
  assert.equal((await management.updateAccount('a1', { enabled: false })).enabled, false);
  assert.equal((await management.listModelMappings()).length, 0);
  await management.saveConfig({ port: 9090 });
  assert.equal(calls[0][0], 'config');
  await assert.rejects(() => management.saveConfig({ debugRawTraffic: 'true' }), /debugRawTraffic/);
  await assert.rejects(() => management.saveConfig({ rawTrafficMaxBytes: 512 }), /rawTrafficMaxBytes/);
  await assert.rejects(() => management.saveConfig({ rawTrafficMode: 'brief' }), /rawTrafficMode/);
});
