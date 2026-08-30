const assert = require('assert/strict');
const test = require('node:test');

const { createChat2ApiModelMapper } = require('./chat2api-model-mapper');

test('模型映射支持 Provider 映射、全局精确映射和通配符', async () => {
  const mapper = createChat2ApiModelMapper({
    dataStore: {
      readCollection: async (name) => (name === 'modelMappings' ? [
        { model: 'fast-*', actualModel: 'qwen-fast', preferredProviderId: 'qwen' },
        { model: 'public-chat', actualModel: 'deepseek-v4-flash' },
      ] : []),
    },
  });
  const provider = {
    id: 'qwen',
    modelMappings: { 'Qwen3.6': 'qwen3.6-internal' },
  };

  assert.deepEqual(await mapper.resolveModel('Qwen3.6', provider), {
    requestedModel: 'Qwen3.6',
    actualModel: 'qwen3.6-internal',
    preferredProviderId: undefined,
    preferredAccountId: undefined,
  });
  assert.equal((await mapper.resolveModel('fast-demo', provider)).actualModel, 'qwen-fast');
  assert.equal((await mapper.resolveModel('public-chat', provider)).actualModel, 'deepseek-v4-flash');
  assert.equal((await mapper.resolveModel('unknown', provider)).actualModel, 'unknown');
});

test('模型映射兼容导入数据的 providerId，并返回 Provider 路由提示', async () => {
  const mapper = createChat2ApiModelMapper({
    dataStore: {
      readCollection: async () => [{
        model: 'Qwen3.6-Flash', actualModel: 'Qwen3.7', providerId: 'qwen',
      }],
    },
  });

  assert.deepEqual(await mapper.resolveModel('Qwen3.6-Flash'), {
    requestedModel: 'Qwen3.6-Flash',
    actualModel: 'Qwen3.7',
    preferredProviderId: 'qwen',
    preferredAccountId: undefined,
  });
});
