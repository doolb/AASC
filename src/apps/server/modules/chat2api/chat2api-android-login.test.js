const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createChat2ApiDataStore } = require('./chat2api-data-store');
const { createChat2ApiOAuthService } = require('./chat2api-oauth-service');

test('Android 登录候选只在 Provider 验证成功后出现在账号列表', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat2api-android-login-'));
  try {
    const dataStore = createChat2ApiDataStore({ rootDir });
    const provider = {
      id: 'deepseek',
      name: 'DeepSeek',
      enabled: true,
      credentialFields: [{ name: 'token', required: true }],
    };
    const service = createChat2ApiOAuthService({
      dataStore,
      providerRegistry: { getProvider: async (providerId) => providerId === provider.id ? provider : null },
      credentialAdapters: {
        deepseek: {
          validate: async (credentials) => ({ valid: credentials.token === 'captured', credentials }),
        },
      },
    });
    const started = await service.startLogin('deepseek');

    assert.equal(started.androidWebView, true);
    assert.equal(started.captureProfile.script, undefined);
    await assert.rejects(
      () => service.completeLogin({ state: started.state, providerId: 'deepseek', credentials: { token: 'invalid' } }),
      /校验失败/,
    );
    assert.deepEqual(await dataStore.listAccounts(), []);

    const result = await service.completeLogin({ state: started.state, providerId: 'deepseek', credentials: { token: 'captured' } });
    assert.equal(result.account.secretConfigured, true);
    assert.doesNotMatch(JSON.stringify(result), /captured/u);
    assert.equal((await dataStore.listAccounts()).length, 1);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
