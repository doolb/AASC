const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const {
  createChat2ApiManualAccountService,
  extractManualCredentials,
  parseCookieHeader,
} = require('../src/apps/server/modules/chat2api/chat2api-manual-account-service');

test('Chat2API 手动认证解析 Cookie 时忽略属性并保留等号', () => {
  assert.deepEqual(parseCookieHeader('Cookie: token=abc==; Path=/; session=value; Secure'), {
    token: 'abc==',
    session: 'value',
  });
  assert.throws(() => parseCookieHeader('Path=/; Secure'), /Cookie 格式无效/);
});

test('Chat2API 手动认证按 Provider 专属 Cookie 映射提取字段', () => {
  assert.deepEqual(extractManualCredentials('mimo', {
    cookie: 'serviceToken=s1; userId=u1; xiaomichatbot_ph=p1',
    credentials: {},
  }), { service_token: 's1', user_id: 'u1', ph_token: 'p1' });
  assert.deepEqual(extractManualCredentials('perplexity', {
    cookie: 'next-auth.session-token=perplexity-secret',
    credentials: {},
  }), { sessionToken: 'perplexity-secret' });
  assert.deepEqual(extractManualCredentials('qwen', {
    cookie: 'tongyi_sso_ticket=qwen-secret',
    credentials: {},
  }), { ticket: 'qwen-secret' });
});

test('Chat2API 手动认证校验成功后保存账号且不返回凭据', async () => {
  const saved = [];
  const service = createChat2ApiManualAccountService({
    dataStore: {
      saveAccount: async (account) => {
        saved.push(account);
        return { accountId: account.accountId, providerId: account.providerId, secretConfigured: true };
      },
    },
    providerRegistry: {
      getProvider: async () => ({
        id: 'mimo', name: 'Mimo', enabled: true,
        credentialFields: [
          { name: 'service_token', required: true },
          { name: 'user_id', required: true },
          { name: 'ph_token', required: true },
        ],
      }),
    },
    credentialAdapters: {
      mimo: {
        validate: async (credentials) => ({ valid: true, credentials, accountInfo: { name: 'Mimo User' } }),
      },
    },
  });

  const result = await service.addManualAccount({
    providerId: 'mimo',
    cookie: 'serviceToken=s1; userId=u1; xiaomichatbot_ph=p1',
  });
  assert.equal(result.account.secretConfigured, true);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].credentials, { service_token: 's1', user_id: 'u1', ph_token: 'p1' });
  assert.equal(JSON.stringify(result).includes('s1'), false);
});

test('Chat2API 手动认证新账号按邮箱生成稳定 accountId', async () => {
  let saved;
  const service = createChat2ApiManualAccountService({
    dataStore: {
      listAccounts: async () => [],
      saveAccount: async (account) => { saved = account; return { accountId: account.accountId, providerId: account.providerId }; },
    },
    providerRegistry: {
      getProvider: async () => ({ id: 'qwen', name: 'Qwen', enabled: true, credentialFields: [{ name: 'ticket', required: true }] }),
    },
    credentialAdapters: {
      qwen: { validate: async (credentials) => ({ valid: true, credentials, accountInfo: {} }) },
    },
  });
  await service.addManualAccount({ providerId: 'qwen', email: ' User@Example.com ', credentials: { ticket: 'secret' } });
  assert.equal(saved.accountId, 'qwen:user@example.com');
});

test('Chat2API 手动认证缺少字段或校验失败时不保存账号', async () => {
  let saveCount = 0;
  let validateCount = 0;
  const service = createChat2ApiManualAccountService({
    dataStore: { saveAccount: async () => { saveCount += 1; return {}; } },
    providerRegistry: {
      getProvider: async () => ({ id: 'qwen', name: 'Qwen', enabled: true, credentialFields: [{ name: 'ticket', required: true }] }),
    },
    credentialAdapters: {
      qwen: {
        validate: async () => { validateCount += 1; return { valid: false, error: 'Ticket 已过期' }; },
      },
    },
  });

  await assert.rejects(() => service.addManualAccount({ providerId: 'qwen', cookie: 'other=value' }), /缺少必填凭据字段: ticket/);
  await assert.rejects(() => service.addManualAccount({ providerId: 'qwen', cookie: 'tongyi_sso_ticket=expired' }), /Ticket 已过期/);
  assert.equal(validateCount, 1);
  assert.equal(saveCount, 0);
});

test('Chat2API 认证方式只允许 Provider 声明的 Cookie，外部登录不能走手动接口', async () => {
  let saveCount = 0;
  const service = createChat2ApiManualAccountService({
    dataStore: { saveAccount: async () => { saveCount += 1; return {}; } },
    providerRegistry: {
      getProvider: async (providerId) => providerId === 'qwen'
        ? { id: 'qwen', name: 'Qwen', enabled: true, credentialFields: [{ name: 'ticket', required: true }] }
        : providerId === 'deepseek'
          ? { id: 'deepseek', name: 'DeepSeek', enabled: true, credentialFields: [{ name: 'token', required: true }] }
          : { id: 'custom-cookie', name: 'Custom Cookie', enabled: true, authType: 'cookie', credentialFields: [{ name: 'cookie', required: true }] },
    },
    credentialAdapters: {
      qwen: { validate: async (credentials) => ({ valid: true, credentials }) },
      deepseek: { validate: async (credentials) => ({ valid: true, credentials }) },
      'custom-cookie': { validate: async (credentials) => ({ valid: true, credentials }) },
    },
  });

  await service.addManualAccount({ providerId: 'qwen', cookie: 'tongyi_sso_ticket=ticket-secret' });
  await assert.rejects(() => service.addManualAccount({ providerId: 'deepseek', authMethod: 'cookie', cookie: 'token=secret' }), /不支持 Cookie/);
  await assert.rejects(() => service.addManualAccount({ providerId: 'qwen', authMethod: 'external' }), /不能通过手动接口/);
  await service.addManualAccount({ providerId: 'custom-cookie', cookie: 'custom=value' });
  assert.equal(saveCount, 2);
});

test('普通网页 Chat2API 控制端提供统一外部认证入口', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/apps/web-mediacenter/ui/public/js/chat2api.js'), 'utf8');
  assert.match(source, new RegExp('/api/chat2api/accounts/manual'));
  assert.match(source, /添加外部认证/);
  assert.match(source, /外部登录/);
  assert.match(source, /chat2apiManualCookie/);
  assert.match(source, /当前 Provider/);
  assert.doesNotMatch(source, /chat2apiAuthMethod/);
  assert.doesNotMatch(source, /renderAuthMethodOptions/);
  assert.doesNotMatch(source, /authMethod/);
  assert.match(source, /不打开登录页/);
});
