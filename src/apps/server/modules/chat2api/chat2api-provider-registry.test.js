const assert = require('assert/strict');
const test = require('node:test');

const { createChat2ApiProviderRegistry } = require('./chat2api-provider-registry');

const createFakeStore = (providers = []) => {
  let records = providers;
  return {
    readCollection: async () => records,
    writeCollection: async (name, value) => {
      assert.equal(name, 'providers');
      records = value;
    },
  };
};

test('Provider 注册表提供当前九个内置 Provider，并保留用户覆盖项', async () => {
  const store = createFakeStore([{ providerId: 'deepseek', enabled: false, description: '用户备注' }]);
  const registry = createChat2ApiProviderRegistry({ dataStore: store });

  const providers = await registry.listProviders();
  assert.equal(providers.length, 9);
  const deepseek = providers.find((provider) => provider.id === 'deepseek');
  assert.equal(deepseek.enabled, false);
  assert.equal(deepseek.description, '用户备注');
  assert.equal(providers.some((provider) => provider.id === 'qwen-ai'), true);
});

test('Provider 注册表支持自定义 Provider 和模型汇总', async () => {
  const store = createFakeStore([]);
  const registry = createChat2ApiProviderRegistry({ dataStore: store });
  await registry.saveProvider({
    providerId: 'local',
    name: '本地兼容接口',
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:9000',
    supportedModels: ['local-chat'],
    modelMappings: { 'local-chat': 'model-v1' },
    enabled: true,
  });

  const provider = await registry.getProvider('local');
  assert.equal(provider.id, 'local');
  assert.equal(provider.modelMappings['local-chat'], 'model-v1');
  assert.deepEqual(await registry.listModels(), ['deepseek-v4-flash', 'deepseek-v4-pro', 'GLM-5.1', 'Kimi-K2.6', 'MiniMax-M2.7', 'MiMo-V2.5-Pro', 'MiMo-V2.5', 'MiMo-V2-Flash', 'Auto', 'Qwen3.6', 'Qwen3.7-Max', 'Qwen3.5-Flash', 'Qwen3-Max', 'Qwen3-Max-Thinking-Preview', 'Qwen3-Coder', 'Qwen3.6-Plus', 'Qwen3.6-35B-A3B', 'Qwen3.6-27B', 'GLM-5-Turbo', 'GLM-5V-Turbo', 'GLM-5', 'GLM-4.7', 'local-chat']);
});
