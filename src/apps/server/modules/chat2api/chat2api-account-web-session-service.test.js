const assert = require('assert/strict');
const test = require('node:test');

const { createChat2ApiAccountWebSessionService } = require('./chat2api-account-web-session-service');
const { getAndroidLoginProfile } = require('./chat2api-login-profiles');

test('豆包同账号白名单Cookie恢复至www与accounts，来源不可被Provider或可变profile副本扩大', async () => {
  const account = { accountId: 'doubao-test', providerId: 'doubaochat', credentials: {
    cookie: 'sessionid=private-session; passport_csrf_token=private-csrf; passport_csrf_token_default=private-default; msToken=private-ms; ttwid=private-ttwid; s_v_web_id=private-fp; unknown=ignored; Domain=evil.example',
    nodeProfile: { deviceId: '123', webId: '456', fp: 'private-fp' },
  } };
  const original = structuredClone(account);
  const copy = getAndroidLoginProfile('doubaochat');
  copy.allowedOrigins.push('https://evil.example');
  copy.cookieBundles[0].origins.push('https://evil.example');
  const service = createChat2ApiAccountWebSessionService({ baseUrl: 'http://127.0.0.1:8080',
    dataStore: { getAccount: async () => account },
    providerRegistry: { getProvider: async () => ({ id: 'doubaochat', loginUrl: 'https://evil.example' }) } });
  const created = await service.createSession(account.accountId);
  assert.equal(JSON.stringify(created).includes('private-'), false);
  const restored = await service.consumeSession(created.sessionId);
  assert.equal(restored.loginUrl, 'https://www.doubao.com');
  const origins = ['https://www.doubao.com', 'https://accounts.doubao.com'];
  assert.deepEqual(restored.allowedOrigins, origins);
  const expected = { sessionid: 'private-session', passport_csrf_token: 'private-csrf', passport_csrf_token_default: 'private-default',
    msToken: 'private-ms', ttwid: 'private-ttwid', s_v_web_id: 'private-fp' };
  assert.equal(restored.cookieMappings.length, 12);
  for (const origin of origins) {
    const cookies = restored.cookieMappings.filter(item => item.origin === origin);
    assert.deepEqual(Object.fromEntries(cookies.map(item => [item.name, item.value])), expected);
    assert.ok(cookies.every(item => !Object.hasOwn(item, 'domain')));
  }
  assert.deepEqual(restored.localStorageMappings, []);
  assert.deepEqual(account, original);
  restored.credentials.nodeProfile.deviceId = 'changed';
  assert.deepEqual(account, original);
  await assert.rejects(service.consumeSession(created.sessionId), e => e.code === 'web_session_expired');
});

test('豆包网页完成只用一次性令牌刷新原账号快照，恢复时按来源分开', async () => {
  const account = { accountId: 'doubao-test', providerId: 'doubaochat', credentialRevision: 'old-revision', credentials: {
    cookie: 'sessionid=private-session; passport_csrf_token=private-csrf',
    cookieSnapshot: { 'https://www.doubao.com': 'sessionid=private-session; passport_csrf_token=private-csrf; www_only=old; sessionid=path-specific',
      'https://accounts.doubao.com': 'accounts_only=old' },
  } };
  const updates = [];
  const service = createChat2ApiAccountWebSessionService({ baseUrl: 'http://127.0.0.1:8080',
    dataStore: { getAccount: async () => account, refreshDoubaoCookieSnapshot: async (...args) => { updates.push(args); return { refreshed: true }; } },
    providerRegistry: { getProvider: async () => ({ id: 'doubaochat' }) } });
  const restored = await service.consumeSession((await service.createSession(account.accountId)).sessionId);
  assert.equal(restored.cookieMappings.find(item => item.name === 'www_only')?.origin, 'https://www.doubao.com');
  assert.equal(restored.cookieMappings.filter(item => item.origin === 'https://www.doubao.com' && item.name === 'sessionid').length, 1);
  assert.equal(restored.cookieMappings.find(item => item.origin === 'https://www.doubao.com' && item.name === 'sessionid').value, 'private-session');
  assert.equal(restored.cookieMappings.find(item => item.name === 'accounts_only')?.origin, 'https://accounts.doubao.com');
  assert.equal(restored.refreshUrl, 'http://127.0.0.1:8080/api/chat2api/accounts/web-session/refresh');
  assert.equal(typeof restored.refreshToken, 'string');
  const snapshot = { 'https://www.doubao.com': 'sessionid=private-session; passport_csrf_token=private-csrf; www_only=new' };
  assert.deepEqual(await service.refreshCredentials(restored.refreshToken, snapshot), { refreshed: true });
  assert.deepEqual(updates[0], [account.accountId, 'old-revision', snapshot]);
  await assert.rejects(service.refreshCredentials(restored.refreshToken, snapshot), error => error.code === 'web_session_expired');
});

test('豆包缺失可选Cookie时不补造，也不将其他Provider凭据恢复到认证子域', async () => {
  let account = { providerId: 'doubaochat', credentials: { cookie: 'sessionid=private-session; unknown=ignored' } };
  const service = createChat2ApiAccountWebSessionService({ baseUrl: 'http://127.0.0.1:8080',
    dataStore: { getAccount: async () => account }, providerRegistry: { getProvider: async providerId => ({ id: providerId }) } });
  const consume = async () => service.consumeSession((await service.createSession('test')).sessionId);
  assert.deepEqual((await consume()).cookieMappings, [
    { origin: 'https://www.doubao.com', name: 'sessionid', value: 'private-session' },
    { origin: 'https://accounts.doubao.com', name: 'sessionid', value: 'private-session' },
  ]);
  account = { providerId: 'doubaochat', credentials: { cookie: 'unknown=ignored' } };
  assert.deepEqual((await consume()).cookieMappings, []);
  account = { providerId: 'glm', credentials: { refresh_token: 'private-glm', cookie: 'sessionid=not-glm' } };
  assert.deepEqual((await consume()).cookieMappings, [{ origin: 'https://chatglm.cn', name: 'chatglm_refresh_token', value: 'private-glm' }]);
});

test('集合来源去重并精确拒绝未允许/伪装子域，未声明来源保持登录来源默认值', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const login = 'https://www.doubao.com';
  const accounts = 'https://accounts.doubao.com';
  for (const [origins, expected] of [
    [undefined, [login]],
    [[accounts, accounts, 'https://evil.example', 'https://accounts.doubao.com.evil.example', 'http://accounts.doubao.com'], [accounts]],
    [[], []],
  ]) {
    // 在隔离模块中提供边界声明，验证真实映射逻辑，不修改冻结的生产profile或require缓存。
    const profile = { loginUrl: login, allowedOrigins: [login, accounts], cookieBundles: [
      { field: 'cookie', names: ['sessionid'], ...(origins ? { origins } : {}) },
    ] };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('./chat2api-account-web-session-service'), 'utf8'), {
      module, URL, Date,
      require: name => name === './chat2api-login-profiles' ? { getAndroidLoginProfile: () => profile } : require(name),
    });
    const service = module.exports.createChat2ApiAccountWebSessionService({ baseUrl: 'http://127.0.0.1:8080',
      dataStore: { getAccount: async () => ({ providerId: 'doubaochat', credentials: { cookie: 'sessionid=private-test; other=ignored' } }) },
      providerRegistry: { getProvider: async () => ({ id: 'doubaochat' }) } });
    const result = await service.consumeSession((await service.createSession('test')).sessionId);
    assert.deepEqual(Array.from(result.cookieMappings, item => item.origin), expected);
    assert.ok(result.cookieMappings.every(item => item.name === 'sessionid'));
  }
});

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
