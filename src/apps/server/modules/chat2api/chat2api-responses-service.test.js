const assert = require('assert/strict');
const test = require('node:test');

const { createChat2ApiResponsesService } = require('./chat2api-responses-service');

const createFakeSessionStore = () => {
  const sessions = new Map();
  return {
    sessions,
    create: async (session) => {
      sessions.set(session.conversationId, { ...session });
      return sessions.get(session.conversationId);
    },
    get: async (conversationId) => sessions.get(conversationId) || null,
    findByResponseId: async (responseId) => [...sessions.values()].find((session) => session.latestResponseId === responseId || session.responseIds?.includes(responseId)) || null,
    save: async (session) => {
      sessions.set(session.conversationId, { ...session });
      return sessions.get(session.conversationId);
    },
    withLock: async (conversationId, operation) => operation(),
  };
};

test('Responses 服务创建会话并让原生 Provider 续接第二轮增量', async () => {
  const sessionStore = createFakeSessionStore();
  const requests = [];
  const service = createChat2ApiResponsesService({
    sessionStore,
    coreAdapter: {
      forwardChatCompletion: async (request, options) => {
        requests.push({ request, options });
        return {
          body: {
            id: 'chat-result',
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: `收到：${request.messages.at(-1).content}` }, finish_reason: 'stop' }],
          },
          providerId: 'qwen',
          accountId: 'qwen-main',
          actualModel: 'Qwen3.7',
          nativeState: { sessionId: 'qwen-session', parentReqId: 'qwen-parent' },
        };
      },
    },
  });

  const first = await service.createResponse({ model: 'Qwen3.6-Flash', input: '你好' });
  const second = await service.createResponse({ model: 'Qwen3.6-Flash', conversation: first.body.conversation.id, input: '你还记得吗？' });
  const third = await service.createResponse({ model: 'Qwen3.6-Flash', previous_response_id: first.body.id, input: '继续回答' });

  assert.match(first.body.id, /^resp_/);
  assert.match(first.body.conversation.id, /^conv_/);
  assert.equal(second.body.output_text, '收到：你还记得吗？');
  assert.equal(third.body.output_text, '收到：继续回答');
  assert.deepEqual(requests[1].options, {
    preferredProviderId: 'qwen',
    preferredAccountId: 'qwen-main',
    responseSession: { nativeState: { sessionId: 'qwen-session', parentReqId: 'qwen-parent' } },
  });
  assert.deepEqual(requests[1].request.messages.map((message) => message.role), ['user']);
  assert.equal(sessionStore.sessions.get(first.body.conversation.id).latestResponseId, third.body.id);
  assert.equal(sessionStore.sessions.get(first.body.conversation.id).responseIds.includes(first.body.id), true);
  assert.equal(sessionStore.sessions.get(first.body.conversation.id).responseIds.includes(second.body.id), true);
});

test('Responses 原生会话续接只把本轮新增输入传给核心适配器', async () => {
  const sessionStore = createFakeSessionStore();
  const requests = [];
  const service = createChat2ApiResponsesService({
    sessionStore,
    coreAdapter: {
      forwardChatCompletion: async (request) => {
        requests.push(request);
        return {
          body: {
            choices: [{ message: { role: 'assistant', content: `收到：${request.messages.at(-1).content}` } }],
          },
          providerId: 'qwen',
          accountId: 'qwen-main',
          actualModel: 'Qwen3.7',
          nativeState: { sessionId: 'qwen-session', parentReqId: 'qwen-parent' },
        };
      },
    },
  });

  const first = await service.createResponse({ model: 'Qwen3.6-Flash', input: '第一轮' });
  await service.createResponse({ model: 'Qwen3.6-Flash', previous_response_id: first.body.id, input: '第二轮' });

  assert.deepEqual(requests[0].messages.map((message) => message.content), ['第一轮']);
  assert.deepEqual(requests[1].messages.map((message) => message.content), ['第二轮']);
});

test('Responses 没有原生会话时续接仍重放本地历史', async () => {
  const sessionStore = createFakeSessionStore();
  const requests = [];
  const service = createChat2ApiResponsesService({
    sessionStore,
    coreAdapter: {
      forwardChatCompletion: async (request) => {
        requests.push(request);
        return {
          body: { choices: [{ message: { role: 'assistant', content: '完成' } }] },
          providerId: 'perplexity',
          accountId: 'perplexity-main',
          actualModel: 'sonar',
          nativeState: {},
        };
      },
    },
  });

  const first = await service.createResponse({ model: 'sonar', input: '第一轮' });
  await service.createResponse({ model: 'sonar', previous_response_id: first.body.id, input: '第二轮' });

  assert.deepEqual(requests[1].messages.map((message) => message.content), ['第一轮', '完成', '第二轮']);
});

test('Pi snapshot 会话允许首次建立并在重建时清空旧 Provider 状态', async () => {
  const sessionStore = createFakeSessionStore();
  const requests = [];
  const service = createChat2ApiResponsesService({
    sessionStore,
    coreAdapter: {
      forwardChatCompletion: async (request, options) => {
        requests.push({ request, options });
        return {
          body: { choices: [{ message: { role: 'assistant', content: '完成' } }] },
          providerId: 'qwen', accountId: 'qwen-main', actualModel: 'Qwen3.7',
          nativeState: { sessionId: `qwen-session-${requests.length}` },
        };
      },
    },
  });
  const metadata = {
    aasc_context_owner: 'pi',
    aasc_pi_session_id: 'pi_snapshot',
    aasc_pi_context_mode: 'snapshot',
  };
  const first = await service.createResponse({
    model: 'Qwen3.7', conversation: 'pi_snapshot', metadata,
    input: [{ role: 'user', content: '第一轮' }],
  });
  await service.createResponse({
    model: 'Qwen3.7', conversation: first.body.conversation.id, metadata,
    input: [
      { role: 'user', content: '第一轮' },
      { role: 'assistant', content: '第一轮回复' },
      { role: 'user', content: '第二轮' },
    ],
  });

  assert.deepEqual(requests[1].request.messages.map((message) => message.content), ['第一轮', '第一轮回复', '第二轮']);
  assert.deepEqual(requests[1].options.responseSession, { nativeState: {} });
  assert.equal(requests[1].options.conversationId, 'pi_snapshot');
  assert.equal(requests[1].options.piSessionId, 'pi_snapshot');
});

test('Pi delta 会话仍只发送增量并复用 Provider 状态', async () => {
  const sessionStore = createFakeSessionStore();
  const requests = [];
  const service = createChat2ApiResponsesService({
    sessionStore,
    coreAdapter: {
      forwardChatCompletion: async (request, options) => {
        requests.push({ request, options });
        return {
          body: { choices: [{ message: { role: 'assistant', content: '完成' } }] },
          providerId: 'qwen', accountId: 'qwen-main', actualModel: 'Qwen3.7',
          nativeState: { sessionId: 'qwen-session' },
        };
      },
    },
  });
  const baseMetadata = { aasc_context_owner: 'pi', aasc_pi_session_id: 'pi_delta' };
  const first = await service.createResponse({
    model: 'Qwen3.7', conversation: 'pi_delta',
    metadata: { ...baseMetadata, aasc_pi_context_mode: 'snapshot' }, input: '第一轮',
  });
  await service.createResponse({
    model: 'Qwen3.7', conversation: first.body.conversation.id,
    metadata: { ...baseMetadata, aasc_pi_context_mode: 'delta' }, input: '第二轮',
  });

  assert.deepEqual(requests[1].request.messages.map((message) => message.content), ['第二轮']);
  assert.deepEqual(requests[1].options.responseSession, { nativeState: { sessionId: 'qwen-session' } });
  assert.equal(requests[1].options.piSessionId, 'pi_delta');
});

test('Responses 服务拒绝未知 previous_response_id 和 conversation 冲突', async () => {
  const sessionStore = createFakeSessionStore();
  const service = createChat2ApiResponsesService({ sessionStore, coreAdapter: { forwardChatCompletion: async () => ({ body: {} }) } });

  await assert.rejects(
    () => service.createResponse({ model: 'model', previous_response_id: 'resp_missing', input: '继续' }),
    (error) => error.statusCode === 404 && error.code === 'response_not_found',
  );
  await assert.rejects(
    () => service.createResponse({ model: 'model', conversation: 'conv_a', previous_response_id: 'resp_a', input: '继续' }),
    (error) => error.statusCode === 400 && error.code === 'invalid_request_error',
  );
});

test('Responses 输入项转换保留系统消息、助手工具调用和工具结果', () => {
  const service = createChat2ApiResponsesService({
    sessionStore: createFakeSessionStore(),
    coreAdapter: { forwardChatCompletion: async () => ({ body: {} }) },
  });
  const messages = service.normalizeInput({
    instructions: '你是助手',
    input: [
      { role: 'user', content: [{ type: 'input_text', text: '查天气' }] },
      { type: 'function_call', id: 'fc-1', name: 'weather', arguments: '{"city":"成都"}' },
      { type: 'function_call_output', call_id: 'fc-1', output: '22度' },
    ],
  });

  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].content, '查天气');
  assert.equal(messages[2].tool_calls[0].function.name, 'weather');
  assert.equal(messages[3].tool_call_id, 'fc-1');
  assert.deepEqual(service.normalizeTools([{ type: 'function', name: 'weather', parameters: { type: 'object' } }]), [{
    type: 'function', function: { name: 'weather', description: '', parameters: { type: 'object' } },
  }]);
});

test('Responses 流式服务按协议顺序输出增量并在结束后保存状态', async () => {
  const sessionStore = createFakeSessionStore();
  const service = createChat2ApiResponsesService({
    sessionStore,
    coreAdapter: {
      forwardChatCompletion: async () => ({
        stream: (async function* streamChunks() {
          yield { choices: [{ delta: { content: '你好' }, index: 0, finish_reason: null }] };
          yield { choices: [{ delta: { content: '世界' }, index: 0, finish_reason: 'stop' }] };
        }()),
        providerId: 'deepseek',
        accountId: 'deepseek-main',
        actualModel: 'deepseek-v4-flash',
        nativeState: { sessionId: 'deepseek-session' },
      }),
    },
  });

  const result = await service.createResponse({ model: 'deepseek-v4-flash', input: [{ role: 'user', content: '说两句' }], stream: true });
  const events = [];
  for await (const event of result.stream) events.push(event);

  assert.deepEqual(events.map((event) => event.type), [
    'response.created',
    'response.output_item.added',
    'response.output_text.delta',
    'response.output_text.delta',
    'response.output_item.done',
    'response.output_text.done',
    'response.completed',
  ]);
  assert.equal(events[2].delta, '你好');
  assert.equal(events[3].delta, '世界');
  assert.equal(events.at(-1).response.output_text, '你好世界');
  assert.equal(events[5].item_id, events.at(-1).response.output[0].id);
  assert.equal(sessionStore.sessions.size, 1);
});

test('Responses 流式服务把 Chat Completions 工具调用转换为 Responses function_call 事件', async () => {
  const sessionStore = createFakeSessionStore();
  const service = createChat2ApiResponsesService({
    sessionStore,
    coreAdapter: {
      forwardChatCompletion: async () => ({
        stream: (async function* streamChunks() {
          yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_weather', type: 'function', function: { name: 'weather', arguments: '{"city"' } }] }, index: 0, finish_reason: null }] };
          yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"成都"}' } }] }, index: 0, finish_reason: 'tool_calls' }] };
        }()),
        providerId: 'qwen',
        accountId: 'qwen-main',
        actualModel: 'Qwen3.7',
        nativeState: { sessionId: 'qwen-session' },
      }),
    },
  });

  const result = await service.createResponse({ model: 'Qwen3.7', input: '查天气', stream: true, tools: [{ type: 'function', name: 'weather', parameters: { type: 'object' } }] });
  const events = [];
  for await (const event of result.stream) events.push(event);

  assert.deepEqual(events.map((event) => event.type), [
    'response.created',
    'response.output_item.added',
    'response.function_call_arguments.delta',
    'response.function_call_arguments.delta',
    'response.function_call_arguments.done',
    'response.output_item.done',
    'response.completed',
  ]);
  assert.equal(events[1].item.type, 'function_call');
  assert.equal(events[2].delta, '{"city"');
  assert.equal(events[4].arguments, '{"city":"成都"}');
  assert.equal(events.at(-1).response.output[0].type, 'function_call');
  assert.equal(events.at(-1).response.output[0].name, 'weather');
});
