const assert = require('assert/strict');
const test = require('node:test');

const {
  getAndroidLoginProfile,
} = require('./chat2api-login-profiles');

test('内置 Provider 返回 Android WebView 捕获配置且不返回任意脚本', () => {
  const profile = getAndroidLoginProfile('deepseek');

  assert.equal(profile.loginUrl, 'https://chat.deepseek.com');
  assert.deepEqual(profile.localStorage, [{ key: 'userToken', field: 'token' }]);
  assert.equal(profile.script, undefined);
  assert.equal(getAndroidLoginProfile('custom'), null);
});

test('九个内置 Provider 都声明允许来源和必填字段', () => {
  for (const providerId of ['deepseek', 'glm', 'kimi', 'minimax', 'mimo', 'perplexity', 'qwen', 'qwen-ai', 'zai']) {
    const profile = getAndroidLoginProfile(providerId);
    assert.ok(profile);
    assert.ok(profile.allowedOrigins.length > 0);
    assert.ok(profile.requiredFields.length > 0);
    assert.equal(profile.script, undefined);
  }
});
