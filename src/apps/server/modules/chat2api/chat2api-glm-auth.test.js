const test = require('node:test');
const assert = require('node:assert/strict');
const { createGlmSignature } = require('./chat2api-glm-auth');
const { createChat2ApiCredentialValidators } = require('./chat2api-credential-validators');

test('GLM官网时间戳校验位与固定签名向量', () => {
  assert.deepEqual(createGlmSignature(1700000000000, 'fixednonce'), {
    'X-Timestamp': '1700000000080', 'X-Nonce': 'fixednonce', 'X-Sign': '16e1979026b6e1f30103f1b7a6460c90'
  });
  assert.match(createGlmSignature()['X-Nonce'], /^[0-9a-f]{32}$/);
  assert.throws(() => createGlmSignature(NaN), /时间戳无效/);
});

test('GLM登录校验提交官网格式时间戳，拒绝上游失败', async () => {
  let status = 200;
  const validators = createChat2ApiCredentialValidators({ httpClient: { request: async request => {
    const h = request.headers, digits = [...h['X-Timestamp']].map(Number);
    assert.equal(digits.at(-2), (digits.reduce((a, b) => a + b, 0) - digits.at(-2)) % 10);
    assert.match(h['X-Nonce'], /^[0-9a-f]{32}$/);
    assert.equal(h.Authorization, 'Bearer private-fixture');
    assert.equal(h['App-Name'], 'chatglm');
    assert.equal(h['X-App-Platform'], 'pc');
    assert.equal(h['X-App-Version'], '0.0.1');
    assert.match(h['X-Request-Id'], /^[0-9a-f]{32}$/);
    return { status, data: status === 200 ? { result: { access_token: 'fixture' } } : { status: 40001 } };
  } } });
  assert.equal((await validators.glm.validate({ refresh_token: 'private-fixture' }, { id: 'glm' })).valid, true);
  status = 400;
  assert.equal((await validators.glm.validate({ refresh_token: 'private-fixture' }, { id: 'glm' })).valid, false);
});
