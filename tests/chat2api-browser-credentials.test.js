'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseArguments, cookieHeader, captureDoubao, captureQwen, chooseAccount,
  createApiClient, saveCaptured, browserChatCompleted,
} = require('../scripts/ops/save-chat2api-browser-credentials');

const makePage = (byOrigin, storage = {}) => ({
  createCDPSession: async () => ({
    send: async (_method, { urls }) => ({ cookies: byOrigin[new URL(urls[0]).origin] || [] }),
    detach: async () => {},
  }),
  evaluate: async () => storage,
});

test('Provider 参数只需名称，默认连接本机 9222；可覆盖端口但不能向远程服务上传凭据', () => {
  assert.deepEqual(parseArguments(['doubao']).debugPort, 9222);
  assert.equal(parseArguments(['doubao']).provider.id, 'doubaochat');
  assert.equal(parseArguments(['qwen', '--debug-port=9223', '--now']).debugPort, 9223);
  assert.equal(parseArguments(['qwen']).provider.id, 'qwen');
  assert.throws(() => parseArguments(['qwen-ai']), /provider_must_be_doubao_or_qwen/);
  assert.throws(() => parseArguments(['doubao', '--api-base=https://example.com']), /invalid_api_base/);
});

test('豆包捕获保留同名不同 Path Cookie，并生成与 Android 相同来源的 Node 资料', async () => {
  const fp = 'fingerprint_12345678';
  const page = makePage({
    'https://www.doubao.com': [
      { name: 'sessionid', value: 'session_123456789012345', domain: '.doubao.com', path: '/' },
      { name: 'passport_csrf_token', value: 'csrf_123456789012345', domain: 'www.doubao.com', path: '/' },
      { name: 's_v_web_id', value: fp, domain: 'www.doubao.com', path: '/' },
      { name: 'extra', value: 'root', domain: '.doubao.com', path: '/' },
      { name: 'extra', value: 'chat', domain: 'www.doubao.com', path: '/chat' },
    ],
    'https://accounts.doubao.com': [
      { name: 'sessionid', value: 'session_123456789012345', domain: '.doubao.com', path: '/' },
    ],
  }, { device: '{"web_id":"123456"}', tokens: '{"web_id":"789012"}',
    userAgent: 'Mozilla/5.0 Test Browser/1.0' });
  const result = await captureDoubao(page);
  assert.equal(result.count, 6);
  assert.equal(result.credentials.nodeProfile.deviceId, '123456');
  assert.equal(result.credentials.nodeProfile.webId, '789012');
  assert.match(result.credentials.cookieSnapshot['https://www.doubao.com'], /^extra=chat;/);
  assert.match(result.credentials.cookieSnapshot['https://www.doubao.com'], /extra=root/);
  assert.equal(cookieHeader([{ name: 'wrong', value: 'secret', domain: '.example.com', path: '/' }],
    'https://www.doubao.com'), '');
});

test('千问只取声明来源的单一 SSO Ticket；多个 Provider 账号不自动选', async () => {
  const page = makePage({
    'https://www.qianwen.com': [
      { name: 'tongyi_sso_ticket', value: 'ticket_123', domain: '.qianwen.com', path: '/' },
      { name: 'other', value: 'private', domain: '.qianwen.com', path: '/' },
    ],
  });
  assert.deepEqual(await captureQwen(page), { credentials: { ticket: 'ticket_123' }, count: 1 });
  assert.throws(() => chooseAccount([{ providerId: 'qwen' }, { providerId: 'qwen' }], 'qwen'), /multiple_provider_accounts/);
});

test('已有豆包账号通过外部网页刷新接口保存，千问通过 OAuth 复用唯一账号', async () => {
  const doubaoCalls = [];
  const doubaoApi = async (method, pathname, body) => {
    doubaoCalls.push({ method, pathname, body });
    if (pathname === '/api/chat2api/accounts') return [{ providerId: 'doubaochat', accountId: 'old-doubao' }];
    if (pathname.endsWith('/web-session')) return { sessionId: 'session' };
    if (pathname.endsWith('/consume')) return { refreshToken: 'refresh' };
    if (pathname.endsWith('/refresh')) return { refreshed: true };
    throw new Error('unexpected route');
  };
  const doubao = await saveCaptured({ providerName: 'doubao', provider: { id: 'doubaochat' },
    captured: { credentials: { cookieSnapshot: { 'https://www.doubao.com': 'sessionid=secret' } } }, api: doubaoApi });
  assert.deepEqual(doubao, { accountId: 'old-doubao', mode: 'updated' });
  assert.deepEqual(doubaoCalls.map(call => call.pathname), [
    '/api/chat2api/accounts', '/api/chat2api/accounts/old-doubao/web-session',
    '/api/chat2api/accounts/web-session/consume', '/api/chat2api/accounts/web-session/refresh',
  ]);
  assert.equal(doubaoCalls.at(-1).body.requestProfile, undefined);

  const qwenCalls = [];
  const qwenApi = async (method, pathname, body) => {
    qwenCalls.push({ method, pathname, body });
    if (pathname === '/api/chat2api/accounts') return [{ providerId: 'qwen', accountId: 'old-qwen' }];
    if (pathname.endsWith('/start')) return { state: 'state' };
    if (pathname.endsWith('/complete')) return { account: { accountId: body.accountId } };
    throw new Error('unexpected route');
  };
  const qwen = await saveCaptured({ providerName: 'qwen', provider: { id: 'qwen' },
    captured: { credentials: { ticket: 'secret' } }, api: qwenApi });
  assert.deepEqual(qwen, { accountId: 'old-qwen', mode: 'updated' });
  assert.equal(qwenCalls.at(-1).body.credentials.ticket, 'secret');
});

test('网页聊天验证要求非空正文和最终完成事件，错误或仅 ACK 不算成功', () => {
  const frame = (event, data = {}) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const answer = frame('CHUNK_DELTA', { text: '早上好' });
  assert.equal(browserChatCompleted(frame('SSE_ACK') + answer + frame('SSE_REPLY_END')), true);
  assert.equal(browserChatCompleted(frame('SSE_ACK') + frame('SSE_REPLY_END')), false);
  assert.equal(browserChatCompleted(answer + frame('STREAM_ERROR', { error_code: 403 }) + frame('SSE_REPLY_END')), false);
  assert.equal(browserChatCompleted(answer + frame('SSE_REPLY_END', { msg_finish_attr: {} })), false);
});

test('管理接口失败只抛公开状态和错误码，不泄露服务端正文', async () => {
  const api = createApiClient('http://127.0.0.1:8083', async () => ({ ok: false, status: 409,
    json: async () => ({ code: 'account_credential_changed', message: 'secret-cookie-value' }) }));
  await assert.rejects(api('POST', '/api/chat2api/accounts/web-session/refresh', {}),
    error => error.message === 'chat2api_http_409_account_credential_changed'
      && !error.message.includes('secret-cookie-value'));
});
