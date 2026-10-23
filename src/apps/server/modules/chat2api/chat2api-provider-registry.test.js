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

test('Provider 注册表提供当前网页与API内置 Provider，并保留用户覆盖项', async () => {
  const store = createFakeStore([{ providerId: 'deepseek', enabled: false, description: '用户备注' }]);
  const registry = createChat2ApiProviderRegistry({ dataStore: store });

  const providers = await registry.listProviders();
  assert.equal(providers.length, 12);
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
  assert.deepEqual(await registry.listModels(), ['qwen-api/qwen-audio-3.1-tts-flash','doubaapi/tts','deepseek-v4-flash', 'deepseek-v4-pro', 'GLM-5.3', 'GLM-Flash', 'GLM-5.1', 'Kimi-K2.6', 'MiniMax-M2.7', 'MiMo-V2.5-Pro', 'MiMo-V2.5', 'MiMo-V2-Flash', 'Auto', 'Qwen3.6', 'Qwen3.7-Max', 'Qwen3.5-Flash', 'Qwen3-Max', 'Qwen3-Max-Thinking-Preview', 'Qwen3-Coder', 'Qwen3.6-Plus', 'Qwen3.6-35B-A3B', 'Qwen3.6-27B', 'GLM-5-Turbo', 'GLM-5V-Turbo', 'GLM-5', 'GLM-4.7', 'doubao', 'doubao-think', 'doubao-expert', 'local-chat']);
});

test('删除 Provider 前由注册表检查关联账号和模型映射', async () => {
  const store = createFakeStore([{ providerId: 'local', name: '本地', type: 'custom', authType: 'token', apiEndpoint: 'http://127.0.0.1:9000' }]);
  const registry = createChat2ApiProviderRegistry({ dataStore: store });
  assert.equal(await registry.deleteProvider('local', { accounts: [{ providerId: 'local' }], mappings: [] }), false);
  assert.equal(await registry.deleteProvider('local', { accounts: [], mappings: [] }), true);
});

test('豆包内置固定来源、凭据和三个文字模式不允许存量覆盖，启停仍尊重用户设置', async () => {
  const registry = createChat2ApiProviderRegistry({ dataStore: createFakeStore([{ providerId: 'doubaochat',
    apiEndpoint: 'https://attacker.test', chatPath: '/redirect', headers: { Cookie: 'wrong' }, supportedModels: ['fake-audio'],
    credentialFields: [{ name: 'ticket', required: true }], type: 'custom', description: '保留备注', enabled: false,
  }]) });
  const provider = await registry.getProvider('doubaochat');
  assert.equal(provider.apiEndpoint, 'https://www.doubao.com');
  assert.equal(provider.chatPath, '/chat/completion');
  assert.equal(provider.type, 'builtin');
  assert.equal(provider.description, '保留备注');
  assert.equal(provider.enabled, false);
  assert.deepEqual(provider.headers, {});
  assert.deepEqual(provider.supportedModels, ['doubao', 'doubao-think', 'doubao-expert']);
  assert.deepEqual(provider.credentialFields.map((field) => field.name), ['cookie']);
  assert.equal(provider.capabilities.nativeTools, false);
  assert.equal(provider.capabilities.nativeContinuation, true);
  assert.deepEqual(provider.capabilities.nativeContinuationTransports, ['node-http']);
  assert.deepEqual(provider.capabilities.nativeContinuationModels, ['doubao']);
  assert.equal((await registry.listModels()).includes('doubao'), false);
});
