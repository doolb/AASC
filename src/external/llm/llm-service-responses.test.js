const assert = require('assert/strict');
const test = require('node:test');

const {
  buildResponsesPayload,
  extractResponsesText,
  normalizeChatTransport
} = require('./llm-service');

test('llm-service 首轮 Responses 请求发送完整上下文', () => {
  const messages = [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '第一轮' }
  ];
  const payload = buildResponsesPayload({
    messages,
    userMessage: '第一轮',
    state: null,
    fingerprint: 'fingerprint-1',
    model: 'qwen',
    maxTokens: 1000,
    temperature: 0.7
  });

  assert.deepEqual(payload.input, messages);
  assert.equal(payload.previous_response_id, undefined);
  assert.equal(payload.max_output_tokens, 1000);
  assert.equal(payload.stream, false);
});

test('llm-service Responses 续聊只发送当前输入并携带 previous_response_id', () => {
  const payload = buildResponsesPayload({
    messages: [
      { role: 'system', content: '旧系统提示' },
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答' },
      { role: 'user', content: '新问题' }
    ],
    userMessage: '新问题',
    state: { conversationId: 'conv_1', latestResponseId: 'resp_1', fingerprint: 'fingerprint-1' },
    fingerprint: 'fingerprint-1',
    model: 'qwen',
    maxTokens: 1000,
    temperature: 0.7,
    stream: true
  });

  assert.deepEqual(payload.input, [{ role: 'user', content: '新问题' }]);
  assert.equal(payload.previous_response_id, 'resp_1');
  assert.equal(payload.conversation, undefined);
  assert.equal(payload.stream, true);
});

test('llm-service 可以提取 Responses 文本并规范化全局 transport', () => {
  assert.equal(extractResponsesText({ output_text: '直接文本' }), '直接文本');
  assert.equal(extractResponsesText({ output: [{ type: 'message', content: [{ type: 'output_text', text: '嵌套文本' }] }] }), '嵌套文本');
  assert.equal(normalizeChatTransport({ protocol: 'openai-responses' }).protocol, 'openai-responses');
  assert.equal(normalizeChatTransport({}).protocol, 'openai-responses');
});
