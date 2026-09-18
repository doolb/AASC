const assert = require('assert/strict');
const test = require('node:test');

const { deriveAccountId, selectAccountId } = require('./chat2api-account-identity');

test('新账号优先使用规范化邮箱生成可读 ID，显式旧 ID 保留', () => {
  assert.equal(deriveAccountId({ providerId: 'qwen', email: ' User@Example.COM ' }), 'qwen:user@example.com');
  assert.equal(selectAccountId({ accountId: 'legacy-7', providerId: 'qwen', email: 'new@example.com' }), 'legacy-7');
});

test('没有邮箱时使用规范化手机号，没有身份时生成随机 ID', () => {
  assert.equal(deriveAccountId({ providerId: 'qwen', phone: ' +86 138-1234-5678 ' }), 'qwen:+8613812345678');
  assert.match(deriveAccountId({ providerId: 'qwen' }), /^qwen-[a-f0-9]{12}$/);
});
