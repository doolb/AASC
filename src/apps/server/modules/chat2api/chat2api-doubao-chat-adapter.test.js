const assert = require('assert/strict');
const { Readable, PassThrough } = require('stream');
const test = require('node:test');
const {
  DOUBAO_COMPLETION_URL, DOUBAO_MODEL_MODES, normalizeDoubaoCredentials, buildDoubaoRequest, createDoubaoChatAdapter,
} = require('./chat2api-doubao-chat-adapter');
const { createChat2ApiProviderAdapters } = require('./chat2api-provider-adapters');
const { prepareManagedToolRequest } = require('./chat2api-tool-calling');

// 所有凭据和网络数据均为纯 mock，不连接官网、Chrome 或真实账号库。
const COOKIE = 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; msToken=mock_ms_token; s_v_web_id=verify_mock_123456789';
const PROFILE = {deviceId:'1234567890123456789',webId:'9876543210123456789',fp:'verify_mock_123456789',userAgent:'Mozilla/5.0 (Linux; Android 9) Chrome/138.0.0.0'};
const provider = { id: 'doubaochat', apiEndpoint: 'https://www.doubao.com', chatPath: '/chat/completion', headers: {} };
const input = (extra = {}) => ({
  request: { model: 'doubao', messages: [{ role: 'user', content: '你好' }], stream: false },
  actualModel: 'doubao', provider, account: { accountId: 'node-mock', credentials: { cookie: COOKIE, nodeProfile: PROFILE } }, ...extra,
});
const event = (name, data = {}) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const textBlock = (text, id = 'block_1') => ({ block_type: 10000, block_id: id, content: { text_block: { text } } });
const blockEvent = (blocks) => event('STREAM_CHUNK', { patch_op: [{ patch_object: 100, patch_value: { content_block: blocks } }] });
const response = (parts) => ({ status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' }, data: Readable.from(parts) });
const collect = async (stream) => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; };

for (const stream of [false, true]) test(`豆包原生仅图${stream ? '流式' : '非流式'}可以完成且忽略头像`, async () => {
  const block = { block_type: 10060, content: { creation_block: { creations: [
    { image: { image_ori: { url: 'https://images.test/one.png' } } },
    { image: { image_ori: { url: 'https://images.test/two.png' } } },
  ] } } };
  const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => response([
    event('SSE_ACK', { ack_client_meta: { conversation_info: { image: 'https://images.test/avatar.png' } } }),
    blockEvent([block]), blockEvent([block]), event('SSE_REPLY_END')
  ]) } });
  const result = await adapter(input({ request: { ...input().request, stream } }));
  let images;
  if (stream) {
    const chunks = await collect(result.stream);
    assert.equal(chunks[0].choices[0].delta.image_generation.status, 'pending');
    images = chunks.at(-1).choices[0].delta.images;
  } else images = result.body.choices[0].message.images;
  assert.deepEqual(images.map(image => image.url), ['https://images.test/one.png', 'https://images.test/two.png']);
});

test('豆包生图开始后中断不能刷新签名重复生成，也不提交未完成图片', async () => {
  let sent = 0; let preparedCount = 0;
  const adapter = createDoubaoChatAdapter({ prepareNodeRequest: async ({ prepared }) => {
    preparedCount += 1; return prepared;
  }, httpClient: { request: async () => {
    sent += 1;
    return response([blockEvent([{ block_type: 10060, content: { creation_block: { creations: [] } } }])]);
  } } });
  await assert.rejects(adapter(input()), error => error.code === 'doubao_incomplete_response');
  assert.equal(sent, 1);
  assert.equal(preparedCount, 1);
});

test('Cookie-only文字必须补齐Node资料，旧网页transport参数不能恢复兼容分支',async()=>{
 let calls=0;const adapter=createDoubaoChatAdapter({httpClient:{request:()=>{calls++;}},browserTransport:{request:()=>{throw Error('页面不得运行')}}});
 await assert.rejects(adapter(input({account:{credentials:{cookie:COOKIE}}})),e=>e.code==='doubao_node_profile_required'&&e.statusCode===422);assert.equal(calls,0);
});
const safeFailure = (code) => (error) => {
  assert.equal(error.code, code);
  assert.doesNotMatch(error.message, /mock_session|mock_csrf|mock_ms_token|a_bogus|secret-body|private-url/u);
  assert.equal('cause' in error, false);
  assert.equal('config' in error, false);
  return true;
};

test('豆包三个公开模型按 0/1/3 请求固定官方来源，无音频、Bearer 或自定义头', () => {
  for (const [model, mode] of Object.entries(DOUBAO_MODEL_MODES)) {
    const call = buildDoubaoRequest(input({
      actualModel: model,
      provider: { ...provider, headers: { Authorization: 'Bearer other-secret', Cookie: 'attacker', Host: 'attacker.test', Origin: 'https://attacker.test' } },
    }));
    assert.equal(new URL(call.url).origin+new URL(call.url).pathname, DOUBAO_COMPLETION_URL);
    assert.equal(call.data.option.need_deep_think, mode);
    assert.equal(call.data.ext.use_deep_think, String(mode));
    assert.equal(call.data.option.is_audio, false);
    assert.equal(call.data.option.tts_switch, false);
    assert.equal(call.data.option.support_lazy_fetch_stream, true);
    assert.equal(call.data.option.sse_recv_event_options.support_chunk_delta, true);
    assert.equal(call.headers.Cookie, COOKIE);
    assert.equal(call.headers['x-tt-passport-csrf-token'], mode === 0 ? undefined : 'mock_csrf_123456789');
    assert.equal(call.headers.Authorization, undefined);
    assert.equal(call.headers.Host, undefined);
    assert.equal(call.headers.Origin, 'https://www.doubao.com');
    assert.equal(call.maxRedirects, 0);
    assert.equal(call.proxy, false);
    assert.doesNotMatch(JSON.stringify(call.data), /mock_session|mock_csrf|mock_ms_token|other-secret/u);
  }
});

test('豆包 Cookie 严格拒绝未知、重复、换行、超限、缺登录/CSRF 及独立 secret 字段', () => {
  const invalid = [
    {}, { cookies: COOKIE }, { cookie: COOKIE, token: 'other-secret' },
    { cookie: `${COOKIE}\r\nHost: attacker.test` }, { cookie: `${COOKIE}; unknown=x` },
    { cookie: `${COOKIE}; sessionid=duplicate_123456789` }, { cookie: `${COOKIE}; Path=/` },
    { cookie: 'sessionid=mock_session_123456789' }, { cookie: 'passport_csrf_token=mock_csrf_123456789' },
    { cookie: 'sessionid=short; passport_csrf_token=short' }, { cookie: `${COOKIE};` },
    { cookie: `${COOKIE}; ttwid="bad"` }, { cookie: `${COOKIE}; ttwid=${'a'.repeat(4097)}` },
    { cookie: `${COOKIE}; passport_csrf_token_default=bad value` }, { cookie: COOKIE.repeat(1000) },
  ];
  for (const credentials of invalid) assert.throws(() => normalizeDoubaoCredentials(credentials), safeFailure('doubao_invalid_credentials'));
  assert.deepEqual(normalizeDoubaoCredentials({ cookie: 'sessionid=mock_session_123456789; passport_csrf_token_default=mock_csrf_123456789' }), {
    cookie: 'sessionid=mock_session_123456789; passport_csrf_token_default=mock_csrf_123456789',
  });
});

test('账号和 Provider 来源隔离；非法目标在触碰 HTTP 前拒绝', async () => {
  let calls = 0;
  const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => { calls += 1; throw new Error('private-url'); } } });
  for (const unsafe of [
    { ...provider, id: 'qwen' }, { ...provider, enabled: false }, { ...provider, apiEndpoint: 'https://doubao.com' },
    { ...provider, apiEndpoint: 'http://www.doubao.com' }, { ...provider, apiEndpoint: 'https://www.doubao.com.attacker.test' },
    { ...provider, apiEndpoint: 'https://user:pass@www.doubao.com' }, { ...provider, chatPath: '/redirect' },
  ]) await assert.rejects(() => adapter(input({ provider: unsafe })), safeFailure('doubao_invalid_provider'));
  await assert.rejects(() => adapter(input({ account: { credentials: { ticket: 'qwen-secret' } } })), safeFailure('doubao_invalid_credentials'));
  assert.equal(calls, 0);
});

test('只允许文字部件、角色及容量，不承诺网页原生工具', async () => {
  const invalidRequests = [
    { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/a.png' } }] }] },
    { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'x' } }] }] },
    { messages: [{ role: 'user', content: [{ type: 'video', video: 'x' }] }] },
    { tools: [{ type: 'function', function: { name: 'test' } }] }, { tool_choice: 'auto' },
    { modalities: ['text', 'audio'] }, { audio: {} },
  ];
  for (const change of invalidRequests) assert.throws(() => buildDoubaoRequest(input({ request: { ...input().request, ...change } })), safeFailure('doubao_text_only'));
  assert.throws(() => buildDoubaoRequest(input({ actualModel: 'seed-tts-2.0' })), safeFailure('doubao_unsupported_model'));
  assert.throws(() => buildDoubaoRequest(input({ request: { model: 'doubao', messages: [{ role: 'user', content: '' }] } })), safeFailure('doubao_invalid_request'));
  assert.throws(() => buildDoubaoRequest(input({ limits: { requestBytes: 20 } })), safeFailure('doubao_request_too_large'));
  const prepared = prepareManagedToolRequest({ ...input().request, tools: [{ type: 'function', function: { name: 'test', parameters: {} } }] }, { nativeState: {} });
  const call = buildDoubaoRequest(input({ request: prepared }));
  assert.match(call.data.messages[0].content_block[0].content.text_block.text, /CHAT2API/u);
  assert.equal(call.data.tools, undefined);
});

test('非流式等待明确结束、正文与思考隔离，用户回显及其他事件不进入回答', async () => {
  const state = { nativeState: {} };
  const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => response([
    event('SSE_ACK', { ack_client_meta: { conversation_id: 'conversation_1', last_section_id: 'section_1' } }),
    event('FULL_MSG_NOTIFY', { content: { content_block: [textBlock('用户回显不能进入正文')] } }),
    blockEvent([{ block_type: 10040, block_id: 'think_open', content: {} }]),
    event('CHUNK_DELTA', { text: '思考内容' }),
    blockEvent([{ block_type: 10040, block_id: 'think_close', content: {} }]),
    blockEvent([textBlock('答')]), event('CHUNK_DELTA', { text: '案' }),
    event('TOOL_INFO', { text: '工具加载提示' }), event('SSE_REPLY_END'),
  ]) } });
  const result = await adapter(input({ responseSession: state }));
  assert.equal(result.body.choices[0].message.content, '答案');
  assert.equal(result.body.choices[0].message.reasoning_content, '思考内容');
  assert.equal(result.body.choices[0].finish_reason, 'stop');
  assert.equal(result.nativeState, state.nativeState);
  assert.equal(result.nativeState.observedConversationId,'conversation_1');
  assert.equal(result.nativeState.observedSectionId,'section_1');
  assert.equal(result.nativeState.status,'ready');assert.equal(result.nativeState.transport,'node-http');
  assert.equal(result.nativeState.accountId,'node-mock');assert.match(result.nativeState.identityFingerprint,/^[a-f0-9]{64}$/u);
});

test('普通和专业模式以同一个思考块的完成标记切换到正文', async () => {
  const liveBlockEvent = blocks => event('STREAM_CHUNK', {
    patch_op: [{ patch_object: 1, patch_value: { content_block: blocks } }],
  });
  const parts = [
    event('STREAM_MSG_NOTIFY', { content: { content_block: [
      { block_type: 10040, block_id: 'thinking_1', is_finish: false, content: { thinking_block: {} } },
    ] } }),
    liveBlockEvent([textBlock('内部思考', 'reasoning_1')]),
    event('CHUNK_DELTA', { text: '过程' }),
    liveBlockEvent([{ block_type: 10040, block_id: 'thinking_1', is_finish: true, content: { thinking_block: {} } }]),
    liveBlockEvent([textBlock('你好', 'answer_1')]),
    event('CHUNK_DELTA', { text: '。' }),
    event('SSE_REPLY_END'),
  ];
  const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => response(parts) } });
  for (const model of ['doubao-think', 'doubao-expert']) {
    const args = input({ actualModel: model, request: { ...input().request, model } });
    const result = await adapter(args);
    assert.equal(result.body.choices[0].message.content, '你好。');
    assert.equal(result.body.choices[0].message.reasoning_content, '内部思考过程');
    const streamed = await adapter({ ...args, request: { ...args.request, stream: true } });
    const chunks = await collect(streamed.stream);
    assert.equal(chunks.map(chunk => chunk.choices[0].delta.content || '').join(''), '你好。');
    assert.equal(chunks.map(chunk => chunk.choices[0].delta.reasoning_content || '').join(''), '内部思考过程');
    assert.equal(chunks.at(-1).choices[0].finish_reason, 'stop');
  }
});

test('流式中文逐字节 UTF-8 分片安全，CRLF、多行 data、心跳与最后无空行结束均正确', async () => {
  const raw = ': keepalive\r\n\r\n' + 'event: CHUNK_DELTA\r\ndata: {\r\ndata: "text":"你好😀"}\r\n\r\n'
    + 'event: SSE_REPLY_END\r\ndata: {}';
  const bytes = Buffer.from(raw, 'utf8');
  const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => response([...bytes].map((byte) => Buffer.from([byte]))) } });
  const result = await adapter(input({ request: { ...input().request, stream: true } }));
  const chunks = await collect(result.stream);
  assert.equal(chunks.map((chunk) => chunk.choices[0].delta.content || '').join(''), '你好😀');
  assert.equal(chunks.at(-1).choices[0].finish_reason, 'stop');
});

test('同一文字块的累计通知与 delta 不重复，文字 JSON patch 按参考102格式解析', async () => {
  const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => response([
    blockEvent([textBlock('你')]), event('CHUNK_DELTA', { text: '好', block_id: 'block_1' }),
    event('STREAM_MSG_NOTIFY', { content: { content_block: [textBlock('你好')] } }),
    event('STREAM_CHUNK', { patch_op: [{ patch_object: 102, patch_value: { content: '{"text":"！"}' } }] }),
    event('STREAM_MSG_NOTIFY', { content: { content_block: [textBlock('你好！')] } }), event('SSE_REPLY_END'),
  ]) } });
  const result = await adapter(input());
  assert.equal(result.body.choices[0].message.content, '你好！');
});

test('流与非流对登录失效/风控/异常响应固定脱敏，失败不提交ACK状态', async () => {
  for (const stream of [false, true]) {
    for (const [name, data, code] of [
      ['gateway-error', { code: 710012001, message: `secret-body ${COOKIE}` }, 'doubao_auth_expired'],
      ['STREAM_ERROR', { error_code: 710022002, error_msg: 'a_bogus=private-url' }, 'doubao_risk_control'],
      ['STREAM_ERROR', { error_code: 999, error_msg: `secret-body ${COOKIE}` }, 'doubao_upstream_failed'],
    ]) {
      const responseSession = { nativeState: {} };
      const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => response([
        event('SSE_ACK', { ack_client_meta: { conversation_id: 'uncommitted_1' } }), event(name, data),
      ]) } });
      const operation = async () => {
        const result = await adapter(input({ request: { ...input().request, stream }, responseSession }));
        if (stream) await collect(result.stream);
      };
      await assert.rejects(operation, safeFailure(code));
      assert.deepEqual(responseSession.nativeState, {});
    }
  }
});

test('非SSE JSON/HTML、HTTP错误及重定向都失败关闭并销毁响应', async () => {
  for (const [status, headers, parts, code] of [
    [200, { 'content-type': 'application/json' }, [JSON.stringify({ code: 710012001, msg: COOKIE })], 'doubao_auth_expired'],
    [200, { 'content-type': 'text/html' }, ['secret-body'], 'doubao_protocol_error'],
    [401, {}, ['secret-body'], 'doubao_auth_expired'], [403, {}, ['secret-body'], 'doubao_risk_control'],
    [429, {}, ['secret-body'], 'doubao_rate_limited'], [302, { location: 'https://attacker.test' }, ['secret-body'], 'doubao_upstream_failed'],
  ]) {
    const source = Readable.from(parts);
    const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => ({ status, headers, data: source }) } });
    await assert.rejects(() => adapter(input()), safeFailure(code));
    assert.equal(source.destroyed, true);
  }
  const source = Readable.from([event('CHUNK_DELTA', { text: 'ok' }), event('SSE_REPLY_END')]);
  const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => ({
    ...response([]), data: source, request: { res: { responseUrl: 'https://attacker.test' } },
  }) } });
  await assert.rejects(() => adapter(input()), safeFailure('doubao_invalid_provider'));
  assert.equal(source.destroyed, true);
});

test('EOF、只思考、空回答、损坏JSON/UTF-8和未知事件不产生假成功', async () => {
  for (const [parts, code] of [
    [[event('CHUNK_DELTA', { text: '不完整' })], 'doubao_incomplete_response'],
    [[event('CHUNK_DELTA', { text: '不完整' }), 'data: [DONE]\n\n'], 'doubao_incomplete_response'],
    [[event('SSE_REPLY_END')], 'doubao_empty_response'],
    [[blockEvent([{ block_type: 10040, block_id: 'thinking', content: {} }]), event('CHUNK_DELTA', { text: '只有思考' }), event('SSE_REPLY_END')], 'doubao_empty_response'],
    [['event: CHUNK_DELTA\ndata: broken-json\n\n'], 'doubao_protocol_error'],
    [[Buffer.from([0xff])], 'doubao_protocol_error'],
    [[event('UNKNOWN_EVENT', { text: '不能当回答' })], 'doubao_incomplete_response'],
  ]) {
    const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => response(parts) } });
    await assert.rejects(() => adapter(input()), safeFailure(code));
  }
});

test('总字节/事件/正文容量有界，握手和无数据流都有总超时', async () => {
  for (const [limits, parts] of [
    [{ streamBytes: 10 }, [event('CHUNK_DELTA', { text: '超限' })]],
    [{ eventBytes: 10 }, ['data: ' + 'x'.repeat(11)]],
    [{ outputBytes: 3 }, [event('CHUNK_DELTA', { text: '超过正文' })]],
    [{ events: 1 }, [': heartbeat\n\n: heartbeat\n\n']],
  ]) {
    const adapter = createDoubaoChatAdapter({ limits, httpClient: { request: async () => response(parts) } });
    await assert.rejects(() => adapter(input()), safeFailure('doubao_stream_limit'));
  }
  const stuck = new PassThrough();
  const adapter = createDoubaoChatAdapter({ limits: { timeoutMs: 20 }, httpClient: { request: async () => ({ ...response([]), data: stuck }) } });
  await assert.rejects(() => adapter(input()), safeFailure('doubao_timeout'));
  assert.equal(stuck.destroyed, true);
  const handshake = createDoubaoChatAdapter({ limits: { timeoutMs: 20 }, httpClient: { request: async () => new Promise(() => {}) } });
  await assert.rejects(() => handshake(input()), safeFailure('doubao_timeout'));
});

test('显式取消与消费者提前return销毁上游，已有取消不发网且不会泄露客户端异常', async () => {
  let calls = 0;
  const cancelled = new AbortController();
  cancelled.abort();
  const before = createDoubaoChatAdapter({ httpClient: { request: async () => { calls += 1; throw new Error(`private-url ${COOKIE}`); } } });
  await assert.rejects(() => before(input({ context: { signal: cancelled.signal } })), safeFailure('doubao_cancelled'));
  assert.equal(calls, 0);
  const failed = createDoubaoChatAdapter({ httpClient: { request: async () => { throw Object.assign(new Error(`private-url ${COOKIE}`), { config: { headers: { Cookie: COOKIE } } }); } } });
  await assert.rejects(() => failed(input()), safeFailure('doubao_upstream_failed'));
  const signal = new AbortController();
  const source = new PassThrough();
  const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => ({ ...response([]), data: source }) } });
  const result = await adapter(input({ request: { ...input().request, stream: true }, context: { signal: signal.signal } }));
  const operation = collect(result.stream);
  signal.abort();
  await assert.rejects(() => operation, safeFailure('doubao_cancelled'));
  assert.equal(source.destroyed, true);
  const earlySource = new PassThrough();
  earlySource.write(event('CHUNK_DELTA', { text: '首片' }));
  const earlyAdapter = createDoubaoChatAdapter({ httpClient: { request: async () => ({ ...response([]), data: earlySource }) } });
  const early = await earlyAdapter(input({ request: { ...input().request, stream: true } }));
  for await (const chunk of early.stream) { assert.equal(chunk.choices[0].delta.content, '首片'); break; }
  assert.equal(earlySource.destroyed, true);
});

test('独立工厂注册豆包且不走可能回显原始错误的流量日志', async () => {
  let traced = 0;
  const adapters = createChat2ApiProviderAdapters({
    rawTrafficLogger: { createHttpClient: () => { traced += 1; throw new Error('不应记录豆包原始事件'); } },
    getConfig: async () => ({ debugRawTraffic: true }),
    httpClient: { request: async () => response([event('CHUNK_DELTA', { text: 'ok' }), event('SSE_REPLY_END')]) },
  });
  const result = await adapters.doubaochat(input());
  assert.equal(result.body.choices[0].message.content, 'ok');
  assert.equal(traced, 0);
});

test('未确认原生续接时，新网页会话重放提供的本地历史，不重复接入旧conversation_id', async () => {
  const calls = [];
  const adapter = createDoubaoChatAdapter({ httpClient: { request: async (call) => {
    calls.push(call);
    return response([event('SSE_ACK', { ack_client_meta: { conversation_id: 'observed_2' } }), event('CHUNK_DELTA', { text: '继续' }), event('SSE_REPLY_END')]);
  } } });
  await adapter(input({
    responseSession: { nativeState: { conversationId: 'unverified_old', observedConversationId: 'observed_1' } },
    request: { model: 'doubao', messages: [{ role: 'system', content: '规则' }, { role: 'user', content: '上一轮' }, { role: 'assistant', content: '上次回答' }, { role: 'user', content: '继续' }] },
  }));
  assert.equal(calls[0].data.client_meta.conversation_id, '');
  assert.equal(calls[0].data.option.need_create_conversation, true);
  assert.equal(calls[0].data.messages[0].content_block[0].content.text_block.text, 'System: 规则\n\nUser: 上一轮\n\nAssistant: 上次回答\n\nUser: 继续');
});

test('现场message.content_block文字快照与10040思考边界正确分离，忽略tts_content', async () => {
  const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => response([
    event('STREAM_MSG_NOTIFY', { message: { content_block: [textBlock('开头')], tts_content: '不应输出音频信息' } }),
    blockEvent([{ block_type: 10040, block_id: 'thinking_open', content: {} }]),
    event('CHUNK_DELTA', { text: '隔离思考' }),
    blockEvent([{ block_type: 10040, block_id: 'thinking_close', content: {} }]),
    blockEvent([{ block_type: 10101, block_id: 'tool_hint', content: {} }]),
    event('CHUNK_DELTA', { text: '工具提示不能当正文' }),
    blockEvent([textBlock('结尾', 'block_2')]), event('SSE_REPLY_END'),
  ]) } });
  const result = await adapter(input());
  assert.equal(result.body.choices[0].message.content, '开头结尾');
  assert.equal(result.body.choices[0].message.reasoning_content, '隔离思考');
});

test('消费者在首片读取前return立即销毁上游，思考边界块总数也受限', async () => {
  const source = new PassThrough();
  const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => ({ ...response([]), data: source }) } });
  const result = await adapter(input({ request: { ...input().request, stream: true } }));
  await result.stream.return();
  assert.equal(source.destroyed, true);
  const limited = createDoubaoChatAdapter({ limits: { blocks: 1 }, httpClient: { request: async () => response([
    blockEvent([{ block_type: 10040, block_id: 'thinking_1', content: {} }, { block_type: 10040, block_id: 'thinking_2', content: {} }]),
  ]) } });
  await assert.rejects(() => limited(input()), safeFailure('doubao_stream_limit'));
});

test('三个模式都可mock聚合，思考/专家缺明确边界时不把未知思考当正文', async () => {
  for (const model of Object.keys(DOUBAO_MODEL_MODES)) {
    const adapter = createDoubaoChatAdapter({ httpClient: { request: async () => response([
      ...(model === 'doubao' ? [] : [
        blockEvent([{ block_type: 10040, block_id: 'open', content: {} }]), event('CHUNK_DELTA', { text: '思考' }),
        blockEvent([{ block_type: 10040, block_id: 'close', content: {} }]),
      ]), event('CHUNK_DELTA', { text: '回答' }), event('SSE_REPLY_END'),
    ]) } });
    const result = await adapter(input({ actualModel: model, request: { ...input().request, model } }));
    assert.equal(result.body.choices[0].message.content, '回答');
    assert.equal(result.body.model, model);
    if (model !== 'doubao') {
      const unknown = createDoubaoChatAdapter({ httpClient: { request: async () => response([event('CHUNK_DELTA', { text: '未确认的思考' }), event('SSE_REPLY_END')]) } });
      await assert.rejects(() => unknown(input({ actualModel: model, request: { ...input().request, model } })), safeFailure('doubao_empty_response'));
    }
  }
});

test('普通模式删除消息字段是JSON对象映射，不能以空数组替代空对象', () => {
  const prepared = buildDoubaoRequest(input());
  const wire = JSON.parse(JSON.stringify(prepared.data));
  assert.equal(Array.isArray(wire.option.related_deleted_message_ids), false);
  assert.deepEqual(wire.option.related_deleted_message_ids, {});
});

test('带图消息按10052附件和10000文本发送，签名补发复用已上传资源',async()=>{
 let uploads=0,sends=0;const bodies=[];
 const adapter=createDoubaoChatAdapter({prepareNodeRequest:async({prepared})=>prepared,
 uploadChatImages:async(images,{signal})=>{uploads++;assert.equal(images[0].data.toString(),'hello');assert.equal(signal.aborted,false);return [{name:'cat.png',uri:'tos-cat',width:8,height:8,format:'png'}]},
 httpClient:{request:async p=>{bodies.push(JSON.parse(JSON.stringify(p.data)));sends++;if(sends===1)return {status:403};return response([blockEvent([textBlock('橘猫')]),event('SSE_REPLY_END')])}}});
 const result=await adapter(input({request:{...input().request,messages:[{role:'user',content:[{type:'text',text:'这张图里有什么？'},{type:'image_url',image_url:{url:'data:image/png;base64,aGVsbG8='}}]}]}}));
 assert.equal(result.body.choices[0].message.content,'橘猫');assert.equal(uploads,1);assert.equal(sends,2);
 assert.deepEqual(bodies[0].messages,bodies[1].messages);assert.equal(bodies[0].messages[0].content_block[0].block_type,10052);
 assert.equal(bodies[0].messages[0].content_block[0].content.attachment_block.attachments[0].image.uri,'tos-cat');
 assert.equal(bodies[0].messages[1].content_block[0].block_type,10000);
});

for(const stream of [false,true])test(`豆包原生仅视频${stream?'流式':'非流式'}不误判图片且正常结束`,async()=>{
 const video={block_type:10060,content:{creation_block:{creations:[{video:{video_url:'https://media.test/a.mp4'}}]}}};
 const adapter=createDoubaoChatAdapter({httpClient:{request:async()=>response([blockEvent([video]),event('SSE_REPLY_END')])}});
 const result=await adapter(input({request:{...input().request,stream}}));
 const message=stream?(await collect(result.stream)).at(-1).choices[0].delta:result.body.choices[0].message;
 assert.equal(message.videos.length,1);assert.equal(message.video_generation.status,'completed');assert.equal(message.image_generation,undefined);
});

test('豆包视频生成开始后断流不重签重发',async()=>{
 let sent=0;const adapter=createDoubaoChatAdapter({prepareNodeRequest:async({prepared})=>prepared,httpClient:{request:async()=>{sent++;return response([blockEvent([{block_type:10060,content:{creation_block:{creations:[{video:{task_id:'task'}}]}}}])])}}});
 await assert.rejects(adapter(input()),e=>e.code==='doubao_incomplete_response');assert.equal(sent,1);
});
