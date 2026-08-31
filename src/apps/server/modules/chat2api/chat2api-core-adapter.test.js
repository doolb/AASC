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

test('Responses 会话把固定 Provider、账号和原生状态传给核心适配层', async () => {
  let selected;
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
    modelMapper: { resolveModel: async (model, item) => ({ requestedModel: model, actualModel: item ? item.modelMappings[model] : model }) },
    loadBalancer: {
      selectAccount: async (...args) => {
        selected = args;
        return { provider, account, actualModel: 'deepseek-v4-flash' };
      },
      markAccountFailed: () => {},
    },
    providerAdapters: {
      deepseek: async (input) => {
        received = input;
        return { body: { id: 'chatcmpl-state', object: 'chat.completion', choices: [{ message: { role: 'assistant', content: '继续' }, finish_reason: 'stop', index: 0 }] }, nativeState: { sessionId: 'next-session' } };
      },
    },
  });

  const result = await adapter.forwardChatCompletion(
    { model: 'public-chat', messages: [{ role: 'user', content: '继续' }] },
    { preferredProviderId: 'deepseek', preferredAccountId: 'main', responseSession: { nativeState: { sessionId: 'old-session' } } },
  );

  assert.deepEqual(selected.slice(2), ['deepseek', 'main']);
  assert.deepEqual(received.responseSession, { nativeState: { sessionId: 'old-session' } });
  assert.deepEqual(result.nativeState, { sessionId: 'next-session' });
});
test('核心适配层统一转换网页 Provider 工具并在原生续聊中去重提示', async () => {
  const received = [];
  const responseSession = { nativeState: {} };
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
    modelMapper: { resolveModel: async (model, item) => ({ requestedModel: model, actualModel: item ? item.modelMappings[model] : model }) },
    loadBalancer: { selectAccount: async () => ({ provider, account, actualModel: 'deepseek-v4-flash' }), markAccountFailed: () => {} },
    providerAdapters: {
      deepseek: async (input) => {
        received.push(input);
        return { body: { choices: [{ message: { role: 'assistant', content: '收到' } }] } };
      },
    },
  });
  const tools = [{
    type: 'function',
    function: { name: 'read', description: '读取文件', parameters: { type: 'object', required: ['path'] } },
  }];

  await adapter.forwardChatCompletion({
    model: 'public-chat',
    messages: [{ role: 'user', content: '读取 package.json' }],
    tools,
    tool_choice: 'auto',
  }, { responseSession });
  await adapter.forwardChatCompletion({
    model: 'public-chat',
    messages: [{ role: 'user', content: '继续读取' }],
    tools,
    tool_choice: 'auto',
  }, { responseSession });

  assert.equal(received.length, 2);
  assert.equal(received[0].request.messages[0].role, 'system');
  assert.match(received[0].request.messages[0].content, /<\|CHAT2API\|tool_calls>/u);
  assert.match(received[0].request.messages[0].content, /read/u);
  assert.equal(received[0].request.tools, undefined);
  assert.equal(received[0].request.tool_choice, undefined);
  assert.equal(received[1].request.messages[0].role, 'user');
  assert.equal(received[1].request.messages[0].content, '继续读取');
  assert.equal(received[1].request.tools, undefined);
  assert.equal(received[1].request.tool_choice, undefined);
  assert.match(responseSession.nativeState.managedToolPromptHash, /^[a-f0-9]{64}$/u);
});

test('核心适配层兼容没有工具指纹的旧原生会话并避免重复 System', async () => {
  let received;
  const responseSession = { nativeState: { sessionId: 'legacy-session' } };
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
    modelMapper: { resolveModel: async (model, item) => ({ requestedModel: model, actualModel: item ? item.modelMappings[model] : model }) },
    loadBalancer: { selectAccount: async () => ({ provider, account, actualModel: 'deepseek-v4-flash' }), markAccountFailed: () => {} },
    providerAdapters: {
      deepseek: async (input) => {
        received = input;
        return { body: { choices: [{ message: { role: 'assistant', content: '继续' } }] } };
      },
    },
  });

  await adapter.forwardChatCompletion({
    model: 'public-chat',
    messages: [{ role: 'user', content: '继续' }],
    tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }],
  }, { responseSession });

  assert.equal(received.request.messages[0].role, 'user');
  assert.equal(received.request.tools, undefined);
  assert.match(responseSession.nativeState.managedToolPromptHash, /^[a-f0-9]{64}$/u);
});
