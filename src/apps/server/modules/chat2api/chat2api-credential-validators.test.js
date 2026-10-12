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

test('豆包登录验证缺少安全只读协议时失败关闭，不发网或返回凭据', async () => {
  let requests = 0;
  const validators = createChat2ApiCredentialValidators({ httpClient: { request: async () => { requests += 1; return { status: 200 }; } } });
  const cookie = 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789';
  const provider = BUILTIN_PROVIDERS.find((item) => item.id === 'doubaochat');
  const result = await validators.doubaochat.validate({ cookie }, provider);
  assert.equal(result.valid, false);
  assert.match(result.error, /安全只读登录校验端点尚未确认/u);
  assert.doesNotMatch(JSON.stringify(result), /mock_session|mock_csrf/u);
  assert.equal(requests, 0);
  for (const credentials of [{ cookie: `${cookie}\r\nmalicious=x` }, { ticket: 'qwen-ticket' }, { cookie, token: 'secret' }]) {
    const failed = await validators.doubaochat.validate(credentials, provider);
    assert.equal(failed.valid, false);
    assert.match(failed.error, /Cookie 或 CSRF 格式无效/u);
  }
  const wrongOrigin = await validators.doubaochat.validate({ cookie }, { ...provider, apiEndpoint: 'https://attacker.test' });
  assert.equal(wrongOrigin.valid, false);
  assert.match(wrongOrigin.error, /固定官方 HTTPS 来源/u);
});

test('豆包手动账号添加实际执行验证，无法验证登录时不会写入账号库', async () => {
  let writes = 0;
  const provider = BUILTIN_PROVIDERS.find((item) => item.id === 'doubaochat');
  const service = createChat2ApiManualAccountService({
    dataStore: { saveAccount: async () => { writes += 1; } },
    providerRegistry: { getProvider: async () => provider },
    credentialAdapters: createChat2ApiCredentialValidators({ httpClient: { request: async () => { throw new Error('不得发网'); } } }),
  });
  await assert.rejects(() => service.addManualAccount({
    providerId: 'doubaochat', cookie: 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789',
  }), (error) => {
    assert.equal(error.code, 'credential_validation_failed');
    assert.match(error.message, /安全只读登录校验端点尚未确认/u);
    assert.doesNotMatch(error.message, /mock_session|mock_csrf/u);
    return true;
  });
  assert.equal(writes, 0);
});
