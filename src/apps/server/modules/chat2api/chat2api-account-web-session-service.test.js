const assert = require('assert/strict');
const test = require('node:test');

const { createChat2ApiAccountWebSessionService } = require('./chat2api-account-web-session-service');

test('网页会话只能成功消费一次并按账号 profile 返回恢复字段', async () => {
  const service = createChat2ApiAccountWebSessionService({
    baseUrl: 'http://127.0.0.1:8080',
    dataStore: {
      getAccount: async (accountId) => accountId === 'qwen:user@example.com'
        ? { accountId, providerId: 'qwen', enabled: true, credentials: { ticket: 'secret-ticket' }, cookie: 'ticket=secret' }
        : null,
    },
    providerRegistry: {
      getProvider: async (providerId) => providerId === 'qwen' ? { id: 'qwen', enabled: true } : null,
    },
    ttlMs: 60_000,
  });

  const created = await service.createSession('qwen:user@example.com');
  assert.equal(created.providerId, 'qwen');
  assert.match(created.consumeUrl, /\/api\/chat2api\/accounts\/web-session\/consume$/);
  const first = await service.consumeSession(created.sessionId);
  assert.equal(first.credentials.ticket, 'secret-ticket');
  assert.equal(first.cookie, 'ticket=secret');
  assert.ok(first.allowedOrigins.includes('https://www.qianwen.com'));
  assert.equal(first.restoreProfile, undefined);
  await assert.rejects(() => service.consumeSession(created.sessionId), /已消费|无效/);
});
