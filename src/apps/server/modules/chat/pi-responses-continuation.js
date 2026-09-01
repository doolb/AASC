'use strict';

// Pi 的 Responses Provider 在进程内运行，因此续接状态不需要写入磁盘。
// 每个 Pi session 单独保存最近一次请求的消息快照和 AASC response id，避免不同聊天会话互相串链。
const createResponsesContinuationTracker = () => {
  const sessions = new Map();

  const getSessionKey = (sessionId) => String(sessionId || 'default');
  const getMessages = (context) => Array.isArray(context && context.messages) ? context.messages : [];
  const getSystemPrompt = (context) => typeof (context && context.systemPrompt) === 'string' ? context.systemPrompt : '';

  // Pi 的 assistant 消息会附带模型、用量、时间戳等运行时字段。这些字段不属于
  // 对话语义，不能因为每轮值不同就让同一条消息不再匹配历史快照。
  const trackedMessageKeys = Object.freeze(['role', 'content', 'toolCallId', 'toolName', 'isError']);
  const volatileKeys = new Set(['api', 'provider', 'model', 'usage', 'stopReason', 'rawStopReason', 'errorMessage', 'timestamp', 'responseId']);
  const normalizeTrackedValue = (value) => {
    if (Array.isArray(value)) return value.map(normalizeTrackedValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
      if (!volatileKeys.has(key)) result[key] = normalizeTrackedValue(value[key]);
      return result;
    }, {});
  };
  const serializeMessage = (message) => JSON.stringify(trackedMessageKeys.reduce((result, key) => {
    if (message && message[key] !== undefined) result[key] = normalizeTrackedValue(message[key]);
    return result;
  }, {}));
  const serializeMessages = (messages) => messages.map(serializeMessage);

  const hasSnapshotPrefix = (snapshot, messages) => {
    if (!Array.isArray(snapshot) || snapshot.length > messages.length) return false;
    return snapshot.every((serialized, index) => serialized === serializeMessage(messages[index]));
  };

  const prepare = (sessionId, context) => {
    const key = getSessionKey(sessionId);
    const messages = getMessages(context);
    const state = sessions.get(key);
    const canContinue = state
      && state.responseId
      && state.systemPrompt === getSystemPrompt(context)
      && hasSnapshotPrefix(state.messages, messages);
    if (!canContinue) {
      sessions.delete(key);
      return { messages, previousResponseId: undefined };
    }

    const delta = messages.slice(state.messages.length);
    // 没有新消息时不发送空 input，也不冒险复用可能已经过期的 response id。
    if (delta.length === 0) {
      sessions.delete(key);
      return { messages, previousResponseId: undefined };
    }
    return { messages: delta, previousResponseId: state.responseId };
  };

  const record = (sessionId, context, responseMessage, responseId) => {
    if (!responseId) return;
    const messages = getMessages(context);
    const completeSnapshot = responseMessage ? [...messages, responseMessage] : messages;
    sessions.set(getSessionKey(sessionId), {
      responseId,
      systemPrompt: getSystemPrompt(context),
      messages: serializeMessages(completeSnapshot),
    });
  };

  const clear = (sessionId) => {
    sessions.delete(getSessionKey(sessionId));
  };

  return { prepare, record, clear };
};

module.exports = { createResponsesContinuationTracker };
