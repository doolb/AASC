const assert = require('assert/strict');
const test = require('node:test');

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
