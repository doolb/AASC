const assert = require('assert/strict');
const test = require('node:test');

const { createChat2ApiLoadBalancer } = require('./chat2api-load-balancer');

const providers = [
  { id: 'deepseek', name: 'DeepSeek', enabled: true, supportedModels: ['deepseek-chat'], modelMappings: { 'deepseek-chat': 'deepseek-v4-flash' } },
  { id: 'disabled', name: 'Disabled', enabled: false, supportedModels: ['deepseek-chat'] },
];
const accounts = [
  { accountId: 'a1', providerId: 'deepseek', enabled: true, status: 'active', todayUsed: 4, lastUsed: 20 },
  { accountId: 'a2', providerId: 'deepseek', enabled: true, status: 'active', todayUsed: 1, lastUsed: 30 },
  { accountId: 'a3', providerId: 'deepseek', enabled: true, status: 'error', todayUsed: 0, lastUsed: 0 },
];

const createRegistry = () => ({
  listProviders: async () => providers,
  getEffectiveModels: (provider) => (provider.supportedModels || []).map((displayName) => ({
    displayName,
    actualModelId: (provider.modelMappings || {})[displayName] || displayName,
  })),
});
const createStore = () => ({ listAccounts: async () => accounts });

test('负载均衡过滤禁用和异常账号，并执行轮询/最低用量策略', async () => {
  const balancer = createChat2ApiLoadBalancer({ providerRegistry: createRegistry(), dataStore: createStore() });
  const first = await balancer.selectAccount('deepseek-chat', 'round-robin');
  const second = await balancer.selectAccount('deepseek-chat', 'round-robin');
  assert.equal(first.account.accountId, 'a1');
  assert.equal(second.account.accountId, 'a2');
  assert.equal(first.actualModel, 'deepseek-v4-flash');
  assert.equal((await balancer.selectAccount('deepseek-chat', 'fill-first')).account.accountId, 'a2');
  assert.equal(await balancer.selectAccount('unknown-model', 'round-robin'), null);
});

test('首选账号优先，失败达到阈值后进入冷却并可故障转移', async () => {
  const balancer = createChat2ApiLoadBalancer({ providerRegistry: createRegistry(), dataStore: createStore(), failureThreshold: 2, recoveryMs: 60_000 });
  assert.equal((await balancer.selectAccount('deepseek-chat', 'round-robin', 'deepseek', 'a2')).account.accountId, 'a2');
  await balancer.markAccountFailed('a1');
  await balancer.markAccountFailed('a1');
  assert.equal((await balancer.selectAccount('deepseek-chat', 'failover')).account.accountId, 'a2');
  await balancer.clearAccountFailure('a1');
  assert.equal((await balancer.selectAccount('deepseek-chat', 'round-robin', 'deepseek', 'a1')).account.accountId, 'a1');
});

test('指定 Provider 的用户模型映射不要求别名存在于内置模型清单', async () => {
  const provider = { id: 'qwen', name: 'Qwen', enabled: true, supportedModels: ['Qwen3.6'] };
  const account = { accountId: 'qwen-main', providerId: 'qwen', enabled: true, status: 'active' };
  const balancer = createChat2ApiLoadBalancer({
    providerRegistry: {
      listProviders: async () => [provider],
      getEffectiveModels: () => [{ displayName: 'Qwen3.6', actualModelId: 'Qwen' }],
    },
    dataStore: { listAccounts: async () => [account] },
  });

  const selection = await balancer.selectAccount('Qwen3.6-Flash', 'round-robin', 'qwen');
  assert.equal(selection.account.accountId, 'qwen-main');
  assert.equal(selection.provider.id, 'qwen');
});
