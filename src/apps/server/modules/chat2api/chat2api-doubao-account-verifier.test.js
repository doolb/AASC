const test = require('node:test');
const assert = require('node:assert/strict');
const { createDoubaoAccountVerifier, verificationAccountInfo } = require('./chat2api-doubao-account-verifier');
const { BUILTIN_PROVIDERS } = require('./chat2api-provider-registry');
const provider = BUILTIN_PROVIDERS.find(item => item.id === 'doubaochat');
const credentials = { cookie: 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789' };
const envelope = cells => ({ status_code: 0, cmd: 3200, downlink_body: { pull_recent_conv_chain_downlink_body: { cells } } });
const response = data => ({ status: 200, data: JSON.stringify(data) });

test('豆包只读验证固定来源、只取一项不取消息，空列表也是结构化成功', async () => {
  for (const cells of [[], [{ title: 'private-title', message: 'private-message' }]]) {
    const calls = [];
    const verifier = createDoubaoAccountVerifier({ httpClient: { request: async config => { calls.push(config); return response(envelope(cells)); } } });
    const result = await verifier.verify(credentials, provider);
    assert.equal(result.verified, true);
    assert.equal(calls.length, 1);
    const config = calls[0], body = config.data.uplink_body.pull_recent_conv_chain_uplink_body;
    assert.equal(new URL(config.url).origin, 'https://www.doubao.com');
    assert.equal(new URL(config.url).pathname, '/im/chain/recent_conv');
    assert.equal(config.maxRedirects, 0);
    assert.equal(config.data.cmd, 3200);
    assert.equal(config.data.channel, 2);
    assert.equal(body.limit, 1);
    assert.equal(body.option.not_need_message, true);
    assert.equal(config.headers['X-Flow-Csrf-Token'], 'mock_csrf_123456789');
    assert.doesNotMatch(JSON.stringify(result), /private|mock_session|cookie|cells/);
    assert.equal(verificationAccountInfo(result).credentialVerification, 'conversation-list');
  }
});

test('HTTP200、任意code0、HTML、匿名、未知结构、非零业务码不能冒充成功', async () => {
  const cases = [
    [{ status: 401 }, 'auth'], [{ status: 403 }, 'risk'], [{ status: 302 }, 'redirect'],
    [response({ code: 0 }), 'response'], [response({ ...envelope([]), status_code: 9 }), 'business'],
    [response({ ...envelope([]), is_login: false }), 'anonymous'],
    [{ status: 200, data: '<html>secret-cookie</html>' }, 'response'],
    [response({ ...envelope([]), cmd: 2001 }), 'response'],
    [response({ status_code: 0, cmd: 3200, downlink_body: {} }), 'response'],
  ];
  for (const [fixture, errorCode] of cases) {
    const verifier = createDoubaoAccountVerifier({ httpClient: { request: async () => fixture } });
    const result = await verifier.verify(credentials, provider);
    assert.equal(result.verified, false);
    assert.equal(result.errorCode, errorCode);
    assert.doesNotMatch(JSON.stringify(result), /secret-cookie|mock_session/);
  }
});

test('格式失败不请求；超大响应、网络错误、超时与取消有界且不泄漏原始错误', async () => {
  let calls = 0;
  const verifier = createDoubaoAccountVerifier({ timeoutMs: 20, httpClient: { request: async config => {
    calls++;
    if (calls === 1) return { status: 200, data: 'x'.repeat(512 * 1024 + 1) };
    if (calls === 2) throw new Error('Cookie=secret; request-url=secret');
    return new Promise(() => {});
  } } });
  assert.equal((await verifier.verify({}, provider)).errorCode, 'credentials');
  assert.equal(calls, 0);
  assert.equal((await verifier.verify(credentials, provider)).errorCode, 'size');
  assert.equal((await verifier.verify(credentials, provider)).errorCode, 'network');
  assert.equal((await verifier.verify(credentials, provider)).errorCode, 'timeout');
  const controller = new AbortController();
  const pending = verifier.verify(credentials, provider, { signal: controller.signal });
  controller.abort();
  assert.equal((await pending).errorCode, 'cancelled');
});

test('验证器达到并发上限立即拒绝，不积累等待队列', async () => {
  const controller = new AbortController();
  const verifier = createDoubaoAccountVerifier({ maxConcurrent: 1, httpClient: { request: async () => new Promise(() => {}) } });
  const pending = verifier.verify(credentials, provider, { signal: controller.signal });
  assert.equal((await verifier.verify(credentials, provider)).errorCode, 'busy');
  controller.abort();
  await pending;
});
