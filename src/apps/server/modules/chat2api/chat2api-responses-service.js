const { randomUUID } = require('crypto');

const createError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const extractText = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((item) => {
    if (!item || typeof item !== 'object') return '';
    return item.text || item.content || '';
  }).join('');
};

const normalizeInputItem = (item) => {
  if (!item || typeof item !== 'object') return null;
  if (item.type === 'function_call') {
    return {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: item.call_id || item.id || `call_${randomUUID().replaceAll('-', '')}`,
        type: 'function',
        function: { name: item.name || '', arguments: item.arguments || '' },
      }],
    };
  }
  if (item.type === 'function_call_output') {
    return {
      role: 'tool',
      tool_call_id: item.call_id || item.id || '',
      content: extractText(item.output),
    };
  }
  const role = item.role || (item.type === 'message' ? 'user' : 'user');
  const normalizedRole = role === 'developer' ? 'system' : role;
  return { role: normalizedRole, content: extractText(item.content !== undefined ? item.content : item.text) };
};

const normalizeInput = (request) => {
  const messages = [];
  if (request.instructions) {
    messages.push({ role: 'system', content: extractText(request.instructions) });
  }
  if (typeof request.input === 'string') {
    messages.push({ role: 'user', content: request.input });
  } else if (Array.isArray(request.input)) {
    for (const item of request.input) {
      const message = normalizeInputItem(item);
      if (message && (message.content || message.tool_calls || message.tool_call_id)) messages.push(message);
    }
  }
  if (messages.length === 0) {
    throw createError(400, 'invalid_request_error', '缺少有效的 input');
  }
  return messages;
};

const normalizeTools = (tools) => {
  if (!Array.isArray(tools)) return undefined;
  return tools.map((tool) => {
    if (!tool || typeof tool !== 'object' || tool.type !== 'function') return tool;
    if (tool.function) return tool;
    return {
      type: 'function',
      function: {
        name: tool.name || '',
        description: tool.description || '',
        parameters: tool.parameters || {},
        ...(tool.strict === undefined ? {} : { strict: tool.strict }),
      },
    };
  });
};

const createResponseId = () => `resp_${randomUUID().replaceAll('-', '')}`;
const createConversationId = () => `conv_${randomUUID().replaceAll('-', '')}`;
const createMessageId = () => `msg_${randomUUID().replaceAll('-', '')}`;

const getAssistantMessage = (body) => {
  const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
  return choice && choice.message ? choice.message : { role: 'assistant', content: '' };
};

const getAssistantText = (message) => extractText(message && message.content);

const createOutput = (message) => {
  const toolCalls = Array.isArray(message && message.tool_calls) ? message.tool_calls : [];
  const output = [];
  if (toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      output.push({
        id: toolCall.id || `fc_${randomUUID().replaceAll('-', '')}`,
        type: 'function_call',
        status: 'completed',
        call_id: toolCall.id || '',
        name: toolCall.function && toolCall.function.name || '',
        arguments: toolCall.function && toolCall.function.arguments || '',
      });
    }
    return output;
  }
  return [{
    id: createMessageId(),
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text: getAssistantText(message), annotations: [] }],
  }];
};

const createResponseBody = ({ responseId, conversationId, previousResponseId, request, chatBody, textOverride, messageId }) => {
  const message = getAssistantMessage(chatBody);
  const outputText = textOverride === undefined ? getAssistantText(message) : textOverride;
  const body = {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    error: null,
    incomplete_details: null,
    model: request.model,
    output: textOverride === undefined ? createOutput(message) : [{
      id: messageId || createMessageId(), type: 'message', status: 'completed', role: 'assistant',
      content: [{ type: 'output_text', text: outputText, annotations: [] }],
    }],
    output_text: outputText,
    previous_response_id: previousResponseId || null,
    conversation: { id: conversationId },
    store: request.store !== false,
  };
  if (chatBody && chatBody.usage) body.usage = chatBody.usage;
  return body;
};

const createChatHistory = (session, inputMessages, assistantMessage) => [
  ...(Array.isArray(session.history) ? session.history : []),
  ...inputMessages,
  { role: 'assistant', content: getAssistantText(assistantMessage), ...(assistantMessage.tool_calls ? { tool_calls: assistantMessage.tool_calls } : {}) },
];

const createChat2ApiResponsesService = ({ sessionStore, coreAdapter } = {}) => {
  if (!sessionStore || typeof sessionStore.get !== 'function' || typeof sessionStore.save !== 'function' || typeof sessionStore.withLock !== 'function') {
    throw new Error('Responses 服务需要会话存储');
  }
  if (!coreAdapter || typeof coreAdapter.forwardChatCompletion !== 'function') {
    throw new Error('Responses 服务需要核心 Chat2API 适配层');
  }

  const validateRequest = (request) => {
    if (!request || typeof request !== 'object') throw createError(400, 'invalid_request_error', '请求体必须是 JSON 对象');
    if (typeof request.model !== 'string' || request.model.trim().length === 0) throw createError(400, 'invalid_request_error', '缺少必填字段 model');
    if (request.conversation !== undefined && typeof request.conversation !== 'string') throw createError(400, 'invalid_request_error', 'conversation 必须是字符串');
    if (request.previous_response_id !== undefined && typeof request.previous_response_id !== 'string') throw createError(400, 'invalid_request_error', 'previous_response_id 必须是字符串');
    if (request.conversation && request.previous_response_id) throw createError(400, 'invalid_request_error', 'conversation 不能与 previous_response_id 同时使用');
  };

  const resolveConversation = async (request) => {
    if (request.previous_response_id) {
      const session = await sessionStore.findByResponseId(request.previous_response_id);
      if (!session) throw createError(404, 'response_not_found', `找不到响应: ${request.previous_response_id}`);
      return { conversationId: session.conversationId, session };
    }
    if (request.conversation) {
      const session = await sessionStore.get(request.conversation);
      if (!session) throw createError(404, 'conversation_not_found', `找不到会话: ${request.conversation}`);
      return { conversationId: request.conversation, session };
    }
    return { conversationId: createConversationId(), session: null };
  };

  const persist = async ({ session, conversationId, request, inputMessages, chatBody, result, responseId }) => {
    const assistantMessage = getAssistantMessage(chatBody);
    const next = {
      ...(session || {}),
      conversationId,
      providerId: result.providerId || session?.providerId || '',
      accountId: result.accountId || session?.accountId || '',
      actualModel: result.actualModel || session?.actualModel || request.model,
      history: createChatHistory(session || {}, inputMessages, assistantMessage),
      nativeState: result.nativeState || session?.nativeState || {},
      latestResponseId: responseId,
      responseIds: [...new Set([...(session?.responseIds || []), ...(session?.latestResponseId ? [session.latestResponseId] : []), responseId])],
      createdAt: session?.createdAt || Date.now(),
    };
    await sessionStore.save(next);
    return next;
  };

  const createResponse = async (request) => {
    validateRequest(request);
    const inputMessages = normalizeInput(request);
    const { conversationId, session: initialSession } = await resolveConversation(request);
    return sessionStore.withLock(conversationId, async () => {
      // 在锁内重新读取，避免并发请求在锁外取得同一份旧历史后互相覆盖。
      const session = await sessionStore.get(conversationId) || initialSession || { conversationId, history: [], nativeState: {} };
      const messages = [...(session.history || []), ...inputMessages];
      const responseSession = { nativeState: { ...(session.nativeState || {}) } };
      const chatRequest = {
        model: request.model,
        messages,
        stream: request.stream === true,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.max_output_tokens === undefined ? {} : { max_tokens: request.max_output_tokens }),
        ...(normalizeTools(request.tools) ? { tools: normalizeTools(request.tools) } : {}),
        ...(request.tool_choice === undefined ? {} : { tool_choice: request.tool_choice }),
      };
      const result = await coreAdapter.forwardChatCompletion(chatRequest, {
        preferredProviderId: session.providerId || undefined,
        preferredAccountId: session.accountId || undefined,
        responseSession,
      });
      const responseId = createResponseId();
      if (!result.stream) {
        const body = createResponseBody({ responseId, conversationId, previousResponseId: request.previous_response_id, request, chatBody: result.body });
        await persist({ session, conversationId, request, inputMessages, chatBody: result.body, result, responseId });
        return { body };
      }
      return { stream: createResponseStream({ result, responseId, conversationId, previousResponseId: request.previous_response_id, request, session, inputMessages, persist }) };
    });
  };

  const createResponseStream = ({ result, responseId, conversationId, previousResponseId, request, session, inputMessages, persist }) => (async function* responseEvents() {
    const outputItemId = createMessageId();
    const created = createResponseBody({ responseId, conversationId, previousResponseId, request, chatBody: { choices: [{ message: { role: 'assistant', content: '' } }] }, textOverride: '' });
    yield { type: 'response.created', response: { ...created, status: 'in_progress', output: [], output_text: '' } };
    let text = '';
    const toolCalls = new Map();
    let textItemCreated = false;
    const ensureTextItem = () => {
      if (textItemCreated) return null;
      textItemCreated = true;
      return {
        type: 'response.output_item.added',
        output_index: 0,
        item: { id: outputItemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
      };
    };
    const ensureToolCall = (toolCall) => {
      const index = Number.isInteger(toolCall.index) ? toolCall.index : toolCalls.size;
      let current = toolCalls.get(index);
      if (!current) {
        const callId = toolCall.id || `call_${randomUUID().replaceAll('-', '')}`;
        current = {
          index,
          id: `fc_${randomUUID().replaceAll('-', '')}`,
          callId,
          name: '',
          arguments: '',
        };
        toolCalls.set(index, current);
      }
      const functionData = toolCall.function || {};
      if (toolCall.id) current.callId = toolCall.id;
      if (functionData.name) current.name = functionData.name;
      if (typeof functionData.arguments === 'string') current.arguments += functionData.arguments;
      return current;
    };
    const createToolCallOutputItem = (toolCall) => ({
      type: 'response.output_item.added',
      output_index: toolCall.index,
      item: {
        id: toolCall.id,
        type: 'function_call',
        status: 'in_progress',
        call_id: toolCall.callId,
        name: toolCall.name,
        arguments: '',
      },
    });
    const createToolCallMessage = () => ({
      role: 'assistant',
      content: null,
      tool_calls: [...toolCalls.values()].map((toolCall) => ({
        id: toolCall.callId,
        type: 'function',
        function: { name: toolCall.name, arguments: toolCall.arguments },
      })),
    });
    for await (const chunk of result.stream) {
      const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      const deltaToolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
      for (const deltaToolCall of deltaToolCalls) {
        const toolCall = ensureToolCall(deltaToolCall);
        if (toolCall.arguments === deltaToolCall.function?.arguments) {
          yield createToolCallOutputItem(toolCall);
        }
        const argumentDelta = deltaToolCall.function?.arguments;
        if (typeof argumentDelta === 'string' && argumentDelta.length > 0) {
          yield {
            type: 'response.function_call_arguments.delta',
            item_id: toolCall.id,
            output_index: toolCall.index,
            delta: argumentDelta,
          };
        }
      }
      const content = delta && typeof delta.content === 'string' ? delta.content : '';
      if (content) {
        const itemAdded = ensureTextItem();
        if (itemAdded) yield itemAdded;
        text += content;
        yield { type: 'response.output_text.delta', item_id: outputItemId, output_index: 0, content_index: 0, delta: content, logprobs: [] };
      }
    }
    const assistantMessage = toolCalls.size > 0 ? createToolCallMessage() : { role: 'assistant', content: text };
    const finalBody = createResponseBody({ responseId, conversationId, previousResponseId, request, chatBody: { choices: [{ message: assistantMessage }] }, ...(toolCalls.size > 0 ? {} : { textOverride: text, messageId: outputItemId }) });
    if (toolCalls.size > 0) {
      for (const toolCall of toolCalls.values()) {
        yield {
          type: 'response.function_call_arguments.done',
          item_id: toolCall.id,
          output_index: toolCall.index,
          arguments: toolCall.arguments,
        };
        yield {
          type: 'response.output_item.done',
          output_index: toolCall.index,
          item: {
            id: toolCall.id,
            type: 'function_call',
            status: 'completed',
            call_id: toolCall.callId,
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        };
      }
    } else {
      if (textItemCreated) {
        yield { type: 'response.output_item.done', output_index: 0, item: { id: outputItemId, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] } };
      }
      yield { type: 'response.output_text.done', item_id: outputItemId, output_index: 0, content_index: 0, text };
    }
    await persist({ session, conversationId, request, inputMessages, chatBody: { choices: [{ message: assistantMessage }] }, result, responseId });
    yield { type: 'response.completed', response: finalBody };
  }());

  return { createResponse, normalizeInput, normalizeTools };
};

module.exports = { createChat2ApiResponsesService, normalizeInput, normalizeTools };
