const assert = require('assert/strict');
const test = require('node:test');

const { createChat2ApiOAuthService } = require('./chat2api-oauth-service');

test('控制端登录返回登录地址，完成后保存账号并只返回脱敏结果', async () => {
  let saved;
  const service = createChat2ApiOAuthService({
    dataStore: {
      createOAuthSession: async (input) => ({ state: 'state-1', ...input }),
      consumeOAuthSession: async (state, providerId) => (state === 'state-1' && providerId === 'deepseek' ? { providerId, loginUrl: 'https://chat.deepseek.com' } : null),
      saveAccount: async (account) => { saved = account; return { accountId: account.accountId, providerId: account.providerId, secretConfigured: true }; },
    },
    providerRegistry: { getProvider: async (id) => (id === 'deepseek' ? { id, name: 'DeepSeek', enabled: true, authType: 'userToken', apiEndpoint: 'https://chat.deepseek.com' } : null) },
    credentialAdapters: { deepseek: { validate: async (credentials) => ({ valid: true, accountInfo: { email: 'user@example.com' }, credentials }) } },
  });
  const started = await service.startLogin('deepseek');
  assert.equal(started.state, 'state-1');
  assert.equal(started.loginUrl, 'https://chat.deepseek.com');
  const result = await service.completeLogin({ state: 'state-1', providerId: 'deepseek', credentials: { token: 'token-secret' }, label: '主账号' });
  assert.equal(result.account.secretConfigured, true);
  assert.equal(saved.credentials.token, 'token-secret');
  assert.equal(result.account.credentials, undefined);
});

test('控制端登录拒绝未知 Provider、禁用 Provider 和重复/错误 state', async () => {
  const service = createChat2ApiOAuthService({
    dataStore: { createOAuthSession: async () => ({ state: 'state-2' }), consumeOAuthSession: async () => null, saveAccount: async () => null },
    providerRegistry: { getProvider: async (id) => {
      if (id === 'disabled') return { id, enabled: false };
      if (id === 'deepseek') return { id, enabled: true, apiEndpoint: 'https://chat.deepseek.com' };
      return null;
    } },
    credentialAdapters: {},
  });
  await assert.rejects(() => service.startLogin('missing'), /Provider/);
  await assert.rejects(() => service.startLogin('disabled'), /未启用/);
  await assert.rejects(() => service.completeLogin({ state: 'bad', providerId: 'deepseek', credentials: { token: 'x' } }), /登录状态无效/);
});
