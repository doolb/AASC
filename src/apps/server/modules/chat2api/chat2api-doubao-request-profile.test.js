const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeDoubaoRequestProfile } = require('./chat2api-doubao-request-profile');
const { buildDoubaoRequest } = require('./chat2api-doubao-chat-adapter');

const cookie = 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; msToken=mock_ms_token; s_v_web_id=verify_mock_123456789';
const nodeProfile = { deviceId: '1234567890123456789', webId: '9876543210123456789',
  fp: 'verify_mock_123456789', userAgent: 'Mozilla/5.0 (Linux; Android 9) Chrome/138.0.0.0' };
const sample = () => ({
  url: 'https://www.doubao.com/chat/completion?aid=497858&device_id=1234567890123456789&web_id=9876543210123456789&fp=verify_mock_123456789&a_bogus=sample_signature&msToken=old_token',
  headers: { 'user-agent': nodeProfile.userAgent, 'x-tt-passport-csrf-token': 'old_csrf', cookie: cookie,
    'x-flow-trace': 'sample_trace', 'accept-encoding': 'gzip, br' },
  body: { client_meta: { conversation_id: '', local_conversation_id: 'old_local', last_section_id: '', last_message_index: null },
    messages: [{ local_message_id: 'old_message', content_block: [{ block_id: 'old_block', content: { text_block: { text: '私人测试原话' } } }] }],
    option: { need_create_conversation: true, unique_key: 'old_unique', create_time_ms: 1,
      recovery_option: { req_create_time_sec: 1 }, sse_recv_event_options: { support_chunk_delta: false } },
    ext: { use_deep_think: '0' } },
  browserVerifiedAt: '2026-10-20T01:00:00.000Z',
});

test('网页成功首轮只保存参数模板，消息与旧会话标识不会进入账号', () => {
  const profile = normalizeDoubaoRequestProfile(sample());
  const packed = JSON.stringify(profile);
  for (const secret of ['私人测试原话', 'old_message', 'old_block', 'old_local', 'old_unique', cookie]) {
    assert.equal(packed.includes(secret), false);
  }
  assert.equal(profile.browserVerifiedAt, '2026-10-20T01:00:00.000Z');
  assert.deepEqual(normalizeDoubaoRequestProfile(profile), profile);
});

test('Node 首轮沿用网页参数并重建消息与会话，当前 Cookie 和 CSRF 覆盖旧值', () => {
  const requestProfile = normalizeDoubaoRequestProfile(sample());
  const call = buildDoubaoRequest({ request: { model: 'doubao', messages: [{ role: 'user', content: '新消息' }] },
    actualModel: 'doubao', provider: { id: 'doubaochat', apiEndpoint: 'https://www.doubao.com', chatPath: '/chat/completion' },
    account: { credentials: { cookie, nodeProfile, requestProfile } } });
  assert.equal(call.doubaoHttp2, true);
  assert.equal(new URL(call.url).searchParams.get('a_bogus'), 'sample_signature');
  assert.equal(new URL(call.url).searchParams.get('msToken'), 'mock_ms_token');
  assert.equal(call.headers['x-tt-passport-csrf-token'], 'mock_csrf_123456789');
  assert.equal(call.headers['x-flow-trace'], 'sample_trace');
  assert.equal(call.data.messages[0].content_block[0].content.text_block.text, '新消息');
  assert.notEqual(call.data.messages[0].local_message_id, 'old_message');
  assert.equal(call.data.client_meta.conversation_id, '');
  assert.match(call.data.client_meta.local_conversation_id, /^local_/u);
  assert.equal(call.data.option.need_create_conversation, true);
  assert.equal(call.data.option.sse_recv_event_options.support_chunk_delta, false);
});

test('跨来源、旧会话和头部注入不能作为登录样本', () => {
  for (const changed of [
    { url: 'https://evil.example/chat/completion' },
    { url: sample().url.replace('/chat/completion', '/other') },
    { body: { ...sample().body, client_meta: { conversation_id: 'old_conversation' } } },
    { headers: { ...sample().headers, origin: 'https://evil.example\r\nCookie: private' } },
  ]) assert.throws(() => normalizeDoubaoRequestProfile({ ...sample(), ...changed }), error => error.code === 'doubao_invalid_request_profile');
});
