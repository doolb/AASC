const assert = require('assert/strict');
const test = require('node:test');

const { createChat2ApiCoreAdapter } = require('./chat2api-core-adapter');

const provider = {
  id: 'deepseek', name: 'DeepSeek', enabled: true,
  supportedModels: ['public-chat'], modelMappings: { 'public-chat': 'deepseek-v4-flash' },
};
const account = {
  accountId: 'main', providerId: 'deepseek', status: 'active', enabled: true,
  accessToken: 'private-token',
};

test('核心适配层解析模型并把完整凭据只传给 Provider adapter', async () => {
  let received;
  const adapter = createChat2ApiCoreAdapter({
    dataStore: {
      getAccount: async () => account,
      listAccounts: async () => [account],
      readCollection: async () => [],
    },
    providerRegistry: {
      listProviders: async () => [provider],
      getEffectiveModels: (item) => item.supportedModels.map((displayName) => ({ displayName, actualModelId: item.modelMappings[displayName] })),
    },
    modelMapper: { resolveModel: async (model, item) => ({ requestedModel: model, actualModel: item ? item.modelMappings[model] : model, preferredProviderId: undefined, preferredAccountId: undefined }) },
    loadBalancer: { selectAccount: async () => ({ provider, account, actualModel: 'deepseek-v4-flash' }), markAccountFailed: () => {} },
    providerAdapters: {
      deepseek: async (input) => {
        received = input;
        return { body: { id: 'chatcmpl-test', object: 'chat.completion', choices: [{ message: { role: 'assistant', content: '你好' }, finish_reason: 'stop', index: 0 }] } };
      },
    },
  });

  const result = await adapter.forwardChatCompletion({ model: 'public-chat', messages: [{ role: 'user', content: '你好' }] });
  assert.equal(result.body.model, 'public-chat');
  assert.equal(received.account.accessToken, 'private-token');
  assert.equal(received.request.model, 'deepseek-v4-flash');
  assert.equal(received.request.messages[0].content, '你好');
});

test('核心适配层没有可用账号时返回可识别的 503 错误', async () => {
  const adapter = createChat2ApiCoreAdapter({
    dataStore: { getAccount: async () => null, listAccounts: async () => [], readCollection: async () => [] },
    providerRegistry: { listProviders: async () => [], getEffectiveModels: () => [] },
    modelMapper: { resolveModel: async (model) => ({ requestedModel: model, actualModel: model }) },
    loadBalancer: { selectAccount: async () => null },
    providerAdapters: {},
  });
  await assert.rejects(
    () => adapter.forwardChatCompletion({ model: 'missing', messages: [{ role: 'user', content: 'x' }] }),
    (error) => error.statusCode === 503 && error.code === 'no_available_account',
  );
});
