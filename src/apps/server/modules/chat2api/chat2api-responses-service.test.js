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

test('Responses 服务创建会话并把第二轮历史传给核心适配器', async () => {
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
  assert.deepEqual(requests[1].request.messages.map((message) => message.role), ['user', 'assistant', 'user']);
  assert.equal(sessionStore.sessions.get(first.body.conversation.id).latestResponseId, third.body.id);
  assert.equal(sessionStore.sessions.get(first.body.conversation.id).responseIds.includes(first.body.id), true);
  assert.equal(sessionStore.sessions.get(first.body.conversation.id).responseIds.includes(second.body.id), true);
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
    'response.output_text.delta',
    'response.output_text.delta',
    'response.output_text.done',
    'response.completed',
  ]);
  assert.equal(events[1].delta, '你好');
  assert.equal(events[2].delta, '世界');
  assert.equal(events.at(-1).response.output_text, '你好世界');
  assert.equal(events[3].item_id, events.at(-1).response.output[0].id);
  assert.equal(sessionStore.sessions.size, 1);
});
