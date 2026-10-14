const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { normalizeDoubaoCredentials, buildDoubaoRequest, createDoubaoChatAdapter } = require('./chat2api-doubao-chat-adapter');
const { createChat2ApiCoreAdapter } = require('./chat2api-core-adapter');
const { createChat2ApiDataStore } = require('./chat2api-data-store');
const { createChat2ApiLoadBalancer } = require('./chat2api-load-balancer');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const profile = { deviceId: '1234567890123456789', webId: '9876543210123456789', fp: 'verify_mock_123456789', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/148.0.0.0' };
const cookie = 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; s_v_web_id=verify_mock_123456789';
const account = { accountId: 'node-demo', providerId: 'doubaochat', enabled: true, status: 'active', credentials: { cookie, nodeProfile: profile } };
const provider = { id: 'doubaochat', enabled: true, apiEndpoint: 'https://www.doubao.com', chatPath: '/chat/completion' };
const input = { account, provider, actualModel: 'doubao', request: { model: 'doubao', messages: [{ role: 'user', content: 'Hi' }] } };
const response = () => ({ status: 200, headers: { 'content-type': 'text/event-stream' }, data: Readable.from(['event: CHUNK_DELTA\ndata: {"text":"OK"}\n\nevent: SSE_REPLY_END\ndata: {}\n\n']) });
test('Node profile严格校验及同账号fp绑定，旧Cookie包仍可正常导入', () => {
  const normalized = normalizeDoubaoCredentials(account.credentials);
  assert.equal(normalized.nodeProfile.deviceId, profile.deviceId);
  assert.equal(normalized.nodeProfile.pcVersion, '3.41.0');
  assert.notEqual(normalized.nodeProfile, profile);
  assert.deepEqual(normalizeDoubaoCredentials({ cookie }), { cookie });
  for (const bad of [null, {}, { ...profile, fp: 'verify_another_identity' }, { ...profile, deviceId: 'https://bad' }, { ...profile, userAgent: 'bad\r\nCookie: leaked' }, { ...profile, a_bogus: 'signed-secret' }, { ...profile, pcVersion: '3?redirect=1' }, { ...profile, msToken: 'bad\nsecret' }]) {
    assert.throws(() => normalizeDoubaoCredentials({ cookie, nodeProfile: bad }), error => error.code === 'doubao_invalid_credentials' && !error.message.includes('secret'));
  }
});
test('Node构造完整同源query/body，三个别名保留模式、禁TTS且不生成签名', () => {
  for (const [model, mode] of [['doubao',0],['doubao-think',1],['doubao-expert',3]]) {
    const call = buildDoubaoRequest({ ...input, actualModel: model, request: { ...input.request, model } });
    const url = new URL(call.url);
    assert.equal(url.origin + url.pathname, 'https://www.doubao.com/chat/completion');
    assert.equal(url.searchParams.get('device_id'), profile.deviceId);
    assert.equal(url.searchParams.get('aid'), '497858');
    assert.equal(url.searchParams.get('web_id'), profile.webId);
    assert.equal(url.searchParams.has('a_bogus'), false);
    assert.equal(url.searchParams.has('msToken'), false);
    assert.equal(call.headers['User-Agent'], profile.userAgent);
    assert.equal(call.data.option.need_deep_think, mode);
    assert.equal(call.data.option.tts_switch, false);
    assert.equal(call.data.option.sse_recv_event_options.support_chunk_delta, true);
    assert.equal(call.data.client_meta.last_message_index, 0);
    assert.equal(call.data.messages[0].content_block[0].is_finish, true);
    assert.equal(call.data.ext.fp, profile.fp);
    assert.equal(call.data.ext.use_submit_pipeline, '1');
    assert.equal(call.maxRedirects, 0);
    assert.equal(call.proxy, false);
  }
});
test('显式Node账号不调用网页transport，最终URL匹配query且流式正常结束', async () => {
  let calls = 0;
  const adapter = createDoubaoChatAdapter({ browserTransport: { request: () => { throw Error('browser_must_not_run'); } }, httpClient: { request: async call => { calls++; return { ...response(), request: { res: { responseUrl: call.url } } }; } } });
  const result = await adapter(input);
  assert.equal(result.body.choices[0].message.content, 'OK');
  const streamed = await adapter({ ...input, request: { ...input.request, stream: true } });
  const parts = []; for await (const part of streamed.stream) parts.push(part);
  assert.equal(parts.at(-1).choices[0].finish_reason, 'stop');
  assert.equal(calls, 2);
  const moved = createDoubaoChatAdapter({ httpClient: { request: async () => ({ ...response(), request: { res: { responseUrl: 'https://www.doubao.com/chat/completion?device_id=other' } } }) } });
  await assert.rejects(() => moved(input), error => error.code === 'doubao_invalid_provider');
});
test('Node失败不调用浏览器、不重发，取消在握手前拒绝', async () => {
  let calls = 0;
  const adapter = createDoubaoChatAdapter({ browserTransport: { request: () => { throw Error('no_fallback'); } }, httpClient: { request: async () => { calls++; return { ...response(), status: 403 }; } } });
  await assert.rejects(() => adapter(input), error => error.code === 'doubao_risk_control');
  assert.equal(calls, 1);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(() => adapter({ ...input, context: { signal: abort.signal } }), error => error.code === 'doubao_cancelled');
  assert.equal(calls, 1);
});
test('Core的Node账号不要求启用Chrome；显式账号映射不允许退选其他账号', async () => {
  let received, secretReads = 0;
  const core = createChat2ApiCoreAdapter({
    dataStore: { getAccount: async () => { secretReads++; return account; }, listAccounts: async () => [account] },
    providerRegistry: { listProviders: async () => [provider] },
    modelMapper: { resolveModel: async () => ({ actualModel: 'doubao' }) },
    loadBalancer: { selectAccount: async () => ({ account: { accountId: account.accountId }, provider }), markAccountFailed() {} },
    getDoubaoWebConfig: () => { throw Error('browser_config_must_not_run'); },
    providerAdapters: { doubaochat: async args => { received = args; return { body: { choices: [{ message: { content: 'OK' } }] } }; } },
  });
  await core.forwardChatCompletion(input.request);
  assert.equal(received.account.accountId, account.accountId);
  assert.equal(secretReads, 1);
  await assert.rejects(() => core.forwardChatCompletion(input.request, { preferredAccountId: 'another-account' }), error => error.code === 'doubao_browser_binding');
});
test('Node profile沿凭证包导入保存，预览和账号列表不泄露profile或Cookie', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-doubao-node-profile-'));
  try {
    const store = createChat2ApiDataStore({ rootDir });
    const imported = { ...account, credentials: { cookie, nodeProfile: { ...profile, msToken: 'private_profile_ms_token' } } };
    const payload = { format: 'aasc-chat2api-accounts', version: 1, accounts: [imported] };
    const preview = await store.previewAccountImport(payload);
    assert.deepEqual(preview.counts, { new: 1, update: 0, invalid: 0 });
    assert.deepEqual(preview.items[0].credentialFields, ['cookie','nodeProfile']);
    const result = await store.mergeAccountImport(payload, preview.confirmation, true);
    const publicData = JSON.stringify([preview, result, await store.listAccounts()]);
    for (const secret of [profile.deviceId,profile.webId,profile.fp,profile.userAgent,'mock_session_123456789','private_profile_ms_token']) assert.equal(publicData.includes(secret), false);
    assert.equal((await store.getAccount(account.accountId)).credentials.nodeProfile.pcVersion, '3.41.0');
    await assert.rejects(() => store.previewAccountImport({ ...payload, accounts: [{ ...account, credentials: { cookie, nodeProfile: { ...profile, fp: 'verify_wrong_identity' } } }] }), error => error.code === 'doubao_invalid_credentials');
  } finally {
    const absoluteRoot = path.resolve(rootDir);
    assert.ok(absoluteRoot.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(absoluteRoot, { recursive: true, force: true });
  }
});
test('真实Store与轮询器混合网页/Node账号时只调度Node池，指定网页账号仍不退选', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-doubao-node-pool-'));
  try {
    const store = createChat2ApiDataStore({ rootDir });
    await store.saveAccount({ ...account, accountId: 'old-browser', credentials: { cookie } });
    await store.saveAccount(account);
    const registry = { listProviders: async () => [provider], getEffectiveModels: () => [{ displayName: 'doubao', actualModelId: 'doubao' }] };
    const mapper = { resolveModel: async () => ({ actualModel: 'doubao' }) };
    const balancer = createChat2ApiLoadBalancer({ providerRegistry: registry, dataStore: store, modelMapper: mapper });
    let calls = 0;
    const core = createChat2ApiCoreAdapter({ dataStore: store, providerRegistry: registry, modelMapper: mapper, loadBalancer: balancer,
      getDoubaoWebConfig: () => { throw Error('browser_config_unavailable'); },
      providerAdapters: { doubaochat: async args => { calls++; assert.equal(args.account.accountId, account.accountId); return { body: { choices: [{ message: { content: 'OK' } }] } }; } },
    });
    for (let index = 0; index < 4; index++) await core.forwardChatCompletion(input.request);
    assert.equal(calls, 4);
    await assert.rejects(() => core.forwardChatCompletion(input.request, { preferredAccountId: 'old-browser' }), error => error.code === 'doubao_node_profile_required' && error.statusCode === 422 && /重新登录/u.test(error.message));
    await assert.rejects(() => core.forwardChatCompletion(input.request, { preferredAccountId: 'missing-account' }), error => error.code === 'no_available_account');
    await store.updateAccount(account.accountId, { enabled: false });
    assert.deepEqual(await store.listDoubaoNodeAccountIds(), []);
  } finally {
    const absoluteRoot = path.resolve(rootDir);
    assert.ok(absoluteRoot.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(absoluteRoot, { recursive: true, force: true });
  }
});
test('Node query只使用提供的真实token且编码为单一参数，优先当前Cookie', () => {
  const onlyProfile = buildDoubaoRequest({ ...input, account: { ...account, credentials: { cookie, nodeProfile: { ...profile, msToken: 'token+/=&a_bogus=private' } } } });
  const first = new URL(onlyProfile.url);
  assert.equal(first.searchParams.get('msToken'), 'token+/=&a_bogus=private');
  assert.equal(first.searchParams.has('a_bogus'), false);
  const currentCookie = buildDoubaoRequest({ ...input, account: { ...account, credentials: { cookie: `${cookie}; msToken=current_real_token`, nodeProfile: { ...profile, msToken: 'previous_token' } } } });
  assert.equal(new URL(currentCookie.url).searchParams.get('msToken'), 'current_real_token');
});
