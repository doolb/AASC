const assert = require('assert/strict');
const test = require('node:test');

const { createResponsesContinuationTracker } = require('./pi-responses-continuation');

const createContext = (messages, systemPrompt = '系统提示') => ({ systemPrompt, messages });

test('Pi Responses tracker 在上下文追加时返回消息增量和 previous_response_id', () => {
  const tracker = createResponsesContinuationTracker();
  const firstContext = createContext([{ role: 'user', content: '第一轮' }]);
  const first = tracker.prepare('pi-session', firstContext);

  assert.deepEqual(first.messages, firstContext.messages);
  assert.equal(first.previousResponseId, undefined);

  tracker.record('pi-session', firstContext, { role: 'assistant', content: [{ type: 'text', text: '第一轮回复' }] }, 'resp_first');
  const secondContext = createContext([
    ...firstContext.messages,
    { role: 'assistant', content: [{ type: 'text', text: '第一轮回复' }] },
    { role: 'user', content: '第二轮' },
  ]);
  const second = tracker.prepare('pi-session', secondContext);

  assert.deepEqual(second.messages, [{ role: 'user', content: '第二轮' }]);
  assert.equal(second.previousResponseId, 'resp_first');
});

test('Pi Responses tracker 在上下文前缀变化时放弃旧 response_id 并发送完整上下文', () => {
  const tracker = createResponsesContinuationTracker();
  const firstContext = createContext([{ role: 'user', content: '第一轮' }]);
  tracker.prepare('pi-session', firstContext);
  tracker.record('pi-session', firstContext, { role: 'assistant', content: [{ type: 'text', text: '第一轮回复' }] }, 'resp_first');

  const changedContext = createContext([{ role: 'user', content: '被压缩后的上下文' }]);
  const prepared = tracker.prepare('pi-session', changedContext);

  assert.deepEqual(prepared.messages, changedContext.messages);
  assert.equal(prepared.previousResponseId, undefined);
});

test('Pi Responses tracker 按 sessionId 隔离响应链', () => {
  const tracker = createResponsesContinuationTracker();
  const context = createContext([{ role: 'user', content: '同一轮' }]);
  tracker.prepare('session-a', context);
  tracker.record('session-a', context, { role: 'assistant', content: [{ type: 'text', text: '回复' }] }, 'resp-a');

  const other = tracker.prepare('session-b', createContext([
    ...context.messages,
    { role: 'assistant', content: [{ type: 'text', text: '回复' }] },
    { role: 'user', content: '新会话' },
  ]));

  assert.equal(other.previousResponseId, undefined);
  assert.deepEqual(other.messages.at(-1), { role: 'user', content: '新会话' });
});

test('Pi Responses tracker 忽略 assistant 运行时元数据后仍能续接', () => {
  const tracker = createResponsesContinuationTracker();
  const firstContext = createContext([{ role: 'user', content: '第一轮' }]);
  tracker.prepare('pi-session', firstContext);
  tracker.record('pi-session', firstContext, {
    role: 'assistant',
    content: [{ type: 'text', text: '第一轮回复' }],
    api: 'openai-responses',
    provider: 'aasc-openai',
    model: 'qwen',
    usage: { input: 100, output: 10 },
    stopReason: 'stop',
    timestamp: Date.now(),
    responseId: 'provider-response-id',
  }, 'resp_first');

  const second = tracker.prepare('pi-session', createContext([
    ...firstContext.messages,
    { role: 'assistant', content: [{ type: 'text', text: '第一轮回复' }] },
    { role: 'user', content: '第二轮' },
  ]));

  assert.deepEqual(second.messages, [{ role: 'user', content: '第二轮' }]);
  assert.equal(second.previousResponseId, 'resp_first');
});
