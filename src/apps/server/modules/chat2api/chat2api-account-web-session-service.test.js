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
  assert.deepEqual(first.cookieMappings.map(mapping => mapping.origin), first.allowedOrigins);
  assert.ok(first.cookieMappings.every(mapping => mapping.name === 'tongyi_sso_ticket' && mapping.value === 'secret-ticket'));
  assert.equal(first.restoreProfile, undefined);
  await assert.rejects(() => service.consumeSession(created.sessionId), /已消费|无效/);
});

test('国内千问恢复兼容Cookie-only及当前ticket覆盖旧Cookie；未知Cookie不恢复', async () => {
  let account = { accountId: 'qwen-test', providerId: 'qwen', cookie: 'other=ignored; tongyi_sso_ticket=cookie-ticket' };
  const service = createChat2ApiAccountWebSessionService({ baseUrl: 'http://127.0.0.1:8080',
    dataStore: { getAccount: async () => account }, providerRegistry: { getProvider: async () => ({ id: 'qwen', loginUrl: 'https://evil.example' }) } });
  const read = async () => service.consumeSession((await service.createSession('qwen-test')).sessionId);
  const cookieOnly = await read();
  assert.equal(cookieOnly.loginUrl, 'https://www.qianwen.com');
  assert.equal(cookieOnly.cookieMappings.length, 3);
  assert.ok(cookieOnly.cookieMappings.every(mapping => mapping.value === 'cookie-ticket' && mapping.name === 'tongyi_sso_ticket'));
  account = { ...account, credentials: { ticket: 'current-ticket' } };
  const updated = await read();
  assert.ok(updated.cookieMappings.every(mapping => mapping.value === 'current-ticket'));
  assert.ok(updated.cookieMappings.every(mapping => updated.allowedOrigins.includes(mapping.origin)));
  account = { ...account, cookie: '', credentials: {} };
  assert.deepEqual((await read()).cookieMappings, []);
});

test('其他Provider仅恢复登录来源，网页会话过期仍拒绝消费', async () => {
  const options = { baseUrl: 'http://127.0.0.1:8080', dataStore: { getAccount: async () => ({ providerId: 'glm', credentials: { refresh_token: 'test' } }) },
    providerRegistry: { getProvider: async () => ({ id: 'glm' }) } };
  const service = createChat2ApiAccountWebSessionService(options);
  const payload = await service.consumeSession((await service.createSession('glm-test')).sessionId);
  assert.deepEqual(payload.cookieMappings, [{ origin: 'https://chatglm.cn', name: 'chatglm_refresh_token', value: 'test' }]);
  const expired = createChat2ApiAccountWebSessionService(options);
  const session = await expired.createSession('glm-test');
  const now = Date.now;
  Date.now = () => session.expiresAt + 1;
  try { await assert.rejects(expired.consumeSession(session.sessionId), /已过期/u); }
  finally { Date.now = now; }
});
