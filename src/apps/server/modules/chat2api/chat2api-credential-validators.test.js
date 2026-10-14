const assert = require('assert/strict');
const test = require('node:test');

const { createChat2ApiManualAccountService } = require('./chat2api-manual-account-service');
const { BUILTIN_PROVIDERS } = require('./chat2api-provider-registry');

const {
  createChat2ApiCredentialValidators,
} = require('./chat2api-credential-validators');

test('凭据验证器调用 Provider 检查接口并返回标准化账号信息', async () => {
  const calls = [];
  const validators = createChat2ApiCredentialValidators({
    httpClient: {
      request: async (config) => {
        calls.push(config);
        return { status: 200, data: { code: 0, data: { biz_data: { email: 'user@example.com' } } } };
      },
    },
  });

  const result = await validators.deepseek.validate({ token: 'captured-token' }, { id: 'deepseek' });

  assert.equal(result.valid, true);
  assert.equal(result.credentials.token, 'captured-token');
  assert.equal(result.accountInfo.email, 'user@example.com');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /users\/current$/u);
});

test('缺少 Provider 凭据时验证器不发起外部请求', async () => {
  let requestCount = 0;
  const validators = createChat2ApiCredentialValidators({
    httpClient: { request: async () => { requestCount += 1; return { status: 200 }; } },
  });

  const result = await validators.deepseek.validate({}, { id: 'deepseek' });

  assert.equal(result.valid, false);
  assert.equal(requestCount, 0);
});

test('豆包添加严格校验格式，远端未知响应仍允许保存未验证账号', async () => {
  let requests = 0;
  const validators = createChat2ApiCredentialValidators({ httpClient: { request: async () => { requests += 1; return { status: 200 }; } } });
  const cookie = 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789';
  const provider = BUILTIN_PROVIDERS.find((item) => item.id === 'doubaochat');
  const result = await validators.doubaochat.validate({ cookie }, provider);
  assert.equal(result.valid, true);
  assert.equal(result.accountInfo.credentialVerification, 'format-only');
  assert.equal(result.accountInfo.credentialVerificationStatus, 'failed');
  assert.deepEqual(result.credentials, { cookie });
  assert.equal(requests, 1);
  for (const credentials of [{ cookie: `${cookie}\r\nmalicious=x` }, { ticket: 'qwen-ticket' }, { cookie, token: 'secret' }]) {
    const failed = await validators.doubaochat.validate(credentials, provider);
    assert.equal(failed.valid, false);
    assert.match(failed.error, /Cookie 或 CSRF 格式无效/u);
  }
  const wrongOrigin = await validators.doubaochat.validate({ cookie }, { ...provider, apiEndpoint: 'https://attacker.test' });
  assert.equal(wrongOrigin.valid, false);
  assert.match(wrongOrigin.error, /固定官方 HTTPS 来源/u);
  assert.equal(requests, 1);
});

test('豆包手动添加允许保存本地格式合法账号并保留未验证标记', async () => {
  let writes = 0;
  const provider = BUILTIN_PROVIDERS.find((item) => item.id === 'doubaochat');
  const service = createChat2ApiManualAccountService({
    dataStore: { saveAccount: async account => { writes += 1; return account; } },
    providerRegistry: { getProvider: async () => provider },
    credentialAdapters: createChat2ApiCredentialValidators({ httpClient: { request: async () => { throw new Error('不得发网'); } } }),
  });
  const result = await service.addManualAccount({
    providerId: 'doubaochat', cookie: 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789',
  });
  assert.equal(result.account.accountInfo.credentialVerification, 'format-only');
  assert.equal(writes, 1);
});
