const { randomUUID } = require('crypto');
const { isDoubaoSession, isReadyDoubaoSession, sessionError } = require('./chat2api-doubao-session');

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

// 这些 Provider 的网页协议带有稳定的会话/父消息标识，可以让上游自行保存上下文。
// 续接时只发送新增 input，避免上游把 AASC 保存的历史当作另一轮消息再次拼入会话。
const NATIVE_CONTINUATION_FIELDS = Object.freeze({
  qwen: ['sessionId'],
  deepseek: ['sessionId'],
  glm: ['conversationId'],
  kimi: ['chatId'],
  mimo: ['conversationId'],
  minimax: ['chatId'],
  'qwen-ai': ['chatId'],
  zai: ['chatId'],
});

const hasNativeContinuation = (session) => {
  // 豆包旧observed/裸conversationId没有通过原生续接验证，不能仅因字段存在而跳过历史。
  if (session?.providerId === 'doubaochat') return isReadyDoubaoSession(session.nativeState);
  const fields = NATIVE_CONTINUATION_FIELDS[session && session.providerId] || [];
  const nativeState = session && session.nativeState;
  return fields.some((field) => typeof nativeState?.[field] === 'string' && nativeState[field].length > 0);
};

// Pi 自己维护完整上下文，因此需要把 Pi 的外层会话和 Provider 原生状态分开处理。
// metadata 只接受 AASC 约定字段，普通 Responses 调用不会进入这条分支。
const getPiContext = (request) => {
  const metadata = request && request.metadata;
  if (!metadata || metadata.aasc_context_owner !== 'pi') return null;
  const sessionId = String(metadata.aasc_pi_session_id || request.conversation || '').trim();
  if (!sessionId) return null;
  return {
    sessionId,
    mode: metadata.aasc_pi_context_mode === 'delta' ? 'delta' : 'snapshot',
  };
};

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

/**
 * 豆包Node原生流的租约覆盖实际消费和最终保存。即使调用方从未next，原截止时间或
 * HTTP断连仍会主动取消上游、标记位置不确定并释放锁；其它Provider不进入此分支。
 */
const manageDoubaoStream = ({ stream, cancel, signal, timeoutMs, onIncomplete, hasPersisted, release }) => {
  let stoppedError, finalizing, closing;
  const finish = () => {
    if (!finalizing) {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      finalizing = Promise.resolve().then(async () => { if (!hasPersisted()) await onIncomplete(); }).finally(release);
    }
    return finalizing;
  };
  const close = () => {
    if (!closing) {
      try { cancel?.(); } catch {}
      closing = Promise.resolve().then(() => stream.return()).finally(finish);
    }
    return closing;
  };
  const stop = (code, message) => {
    if (!stoppedError) stoppedError = createError(code === 'doubao_timeout' ? 504 : 499,code,message);
    // 自动取消是后台清理，但失败状态已通过onIncomplete阻断后续续接，不输出原始存储错误。
    close().catch(() => {});
  };
  const onAbort = () => stop('doubao_cancelled','豆包文字请求已取消');
  const timer = setTimeout(() => stop('doubao_timeout','豆包文字请求超时'), Math.max(1,timeoutMs));
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return {
    [Symbol.asyncIterator]() { return this; },
    next: async () => {
      if (stoppedError) { await finish(); throw stoppedError; }
      try {
        const value = await stream.next();
        if (stoppedError) throw stoppedError;
        if (value.done || value.value?.type === 'response.completed') await finish();
        return value;
      } catch (error) {
        try { cancel?.(); } catch {}
        await finish(); throw stoppedError || error;
      }
    },
    return: async () => {
      if (!stoppedError) stoppedError = createError(499,'doubao_cancelled','豆包文字请求已取消');
      await close(); return { done: true, value: undefined };
    },
  };
};

const createChat2ApiResponsesService = ({ sessionStore, coreAdapter, applicationService, speechTimeoutMs = 60000, doubaoSessionTimeoutMs = 120000 } = {}) => {
  if (!sessionStore || typeof sessionStore.get !== 'function' || typeof sessionStore.save !== 'function' || typeof sessionStore.withLock !== 'function') {
    throw new Error('Responses 服务需要会话存储');
  }
  if (!coreAdapter || typeof coreAdapter.forwardChatCompletion !== 'function') {
    throw new Error('Responses 服务需要核心 Chat2API 适配层');
  }
  const uncertainConversations = new Set();
  let blockContinuations = false;

  const validateRequest = (request) => {
    if (!request || typeof request !== 'object') throw createError(400, 'invalid_request_error', '请求体必须是 JSON 对象');
    if (typeof request.model !== 'string' || request.model.trim().length === 0) throw createError(400, 'invalid_request_error', '缺少必填字段 model');
    if (request.conversation !== undefined && typeof request.conversation !== 'string') throw createError(400, 'invalid_request_error', 'conversation 必须是字符串');
    if (request.previous_response_id !== undefined && typeof request.previous_response_id !== 'string') throw createError(400, 'invalid_request_error', 'previous_response_id 必须是字符串');
    if (request.conversation && request.previous_response_id) throw createError(400, 'invalid_request_error', 'conversation 不能与 previous_response_id 同时使用');
  };

  const resolveConversation = async (request, piContext) => {
    if (request.previous_response_id) {
      const session = await sessionStore.findByResponseId(request.previous_response_id);
      if (!session) throw createError(404, 'response_not_found', `找不到响应: ${request.previous_response_id}`);
      return { conversationId: session.conversationId, session };
    }
    if (request.conversation) {
      const session = await sessionStore.get(request.conversation);
      if (!session && piContext && piContext.sessionId === request.conversation) {
        return { conversationId: request.conversation, session: null };
      }
      if (!session) throw createError(404, 'conversation_not_found', `找不到会话: ${request.conversation}`);
      return { conversationId: request.conversation, session };
    }
    return { conversationId: createConversationId(), session: null };
  };

  const persist = async ({ session, conversationId, request, inputMessages, chatBody, result, responseId, piContext }) => {
    const assistantMessage = getAssistantMessage(chatBody);
    const historySession = piContext?.mode === 'snapshot' ? { ...(session || {}), history: [] } : session;
    const next = {
      ...(session || {}),
      conversationId,
      providerId: result.providerId || session?.providerId || '',
      accountId: result.accountId || session?.accountId || '',
      actualModel: result.actualModel || session?.actualModel || request.model,
      history: createChatHistory(historySession || {}, inputMessages, assistantMessage),
      nativeState: result.nativeState || session?.nativeState || {},
      latestResponseId: responseId,
      responseIds: [...new Set([...(session?.responseIds || []), ...(session?.latestResponseId ? [session.latestResponseId] : []), responseId])],
      createdAt: session?.createdAt || Date.now(),
    };
    await sessionStore.save(next);
    return next;
  };

  const createResponse = async (request, options = {}) => {
    const startedAt = Date.now();
    validateRequest(request);
    if(applicationService){
      const budget=Number.isFinite(speechTimeoutMs)&&speechTimeoutMs>0?Math.min(speechTimeoutMs,60000):60000;
      const deadline=startedAt+budget;
      let timer,onAbort,plan;
      // 映射IO也属于入口请求；取消/截止不能等到开始合成才生效。
      try {
        if(options.signal?.aborted)throw createError(499,'request_cancelled','请求已取消');
        plan=await Promise.race([applicationService.plan(request),new Promise((resolve,reject)=>{
          onAbort=()=>reject(createError(499,'request_cancelled','请求已取消'));
          options.signal?.addEventListener('abort',onAbort,{once:true});
          if(options.signal?.aborted)return onAbort();
          timer=setTimeout(()=>reject(createError(504,'application_timeout','模型应用规划超时')),Math.max(0,deadline-Date.now()));
        })]);
      }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);}
      if(options.signal?.aborted)throw createError(499,'request_cancelled','请求已取消');
      if(plan.application==='tts'){
        const remaining=deadline-Date.now();
        if(remaining<=0)throw createError(504,'speech_timeout','语音请求超时');
        return applicationService.createAudioResponse(request,plan,{...options,timeoutMs:remaining});
      }
      request={...request,instructions:plan.instructions};
    }else require('./chat2api-content').assertTextOnly(request.input);
    const inputMessages = normalizeInput(request);
    const piContext = getPiContext(request);
    const { conversationId, session: initialSession } = await resolveConversation(request, piContext);
    const duration = Number.isSafeInteger(doubaoSessionTimeoutMs) && doubaoSessionTimeoutMs > 0 ? Math.min(doubaoSessionTimeoutMs,120000) : 120000;
    let retainsLease = false;
    const operation = async (releaseLease = () => {}) => {
      // 在锁内重新读取，避免并发请求在锁外取得同一份旧历史后互相覆盖。
      const session = await sessionStore.get(conversationId) || initialSession || { conversationId, history: [], nativeState: {} };
      if (piContext?.mode !== 'snapshot' && (uncertainConversations.has(conversationId)
        || (session.providerId === 'doubaochat' && isDoubaoSession(session.nativeState) && session.nativeState.status === 'uncertain'))) throw sessionError('doubao_session_uncertain');
      const canUseNativeContinuation = hasNativeContinuation(session);
      const messages = piContext?.mode === 'snapshot' || canUseNativeContinuation
        ? inputMessages
        : [...(session.history || []), ...inputMessages];
      const responseSession = {
        nativeState: piContext?.mode === 'snapshot'
          ? {}
          : { ...(session.nativeState || {}) },
      };
      // 私有非枚举属性保持既有Provider参数契约，不持久化，也不接受客户端metadata指定。
      Object.defineProperty(responseSession,'doubaoDeadlineAt',{value:startedAt+duration});
      // 原生会话的上游模型不可被后续映射编辑悄悄替换；私有元数据不写入Provider消息体。
      if(canUseNativeContinuation&&piContext?.mode!=='snapshot')Object.defineProperty(responseSession,'boundModel',{value:{model:session.actualModel,providerId:session.providerId,accountId:session.accountId}});
      let persisted = false, markingUncertain;
      const markUncertain = () => {
        if (persisted || !responseSession.doubaoContinuationStarted || !isReadyDoubaoSession(session.nativeState)) return Promise.resolve();
        if (!markingUncertain) {
          // 写失败也不能在当前运行实例中继续使用旧上游位置。集合有界，满后保守阻断原生续接。
          if (uncertainConversations.size < 1024) uncertainConversations.add(conversationId); else blockContinuations = true;
          markingUncertain = sessionStore.save({ ...session, nativeState: { ...session.nativeState, status: 'uncertain' } }).catch(() => {
            throw createError(503,'doubao_session_storage_failed','豆包会话状态保存失败，请新建会话');
          });
        }
        return markingUncertain;
      };
      if (blockContinuations && canUseNativeContinuation && session.providerId === 'doubaochat' && piContext?.mode !== 'snapshot') throw sessionError('doubao_session_uncertain');
      const saveCompleted = async (args) => {
        if (responseSession.doubaoNodeMode && options.signal?.aborted) throw createError(499,'doubao_cancelled','豆包文字请求已取消');
        try {
          const saved = await persist(args);
          persisted = true;
          uncertainConversations.delete(conversationId);
          return saved;
        } catch (error) {
          if (responseSession.doubaoNodeMode) throw createError(503,'doubao_session_storage_failed','豆包会话状态保存失败，请新建会话');
          throw error;
        }
      };
      const chatRequest = {
        model: request.model,
        messages,
        stream: request.stream === true,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.max_output_tokens === undefined ? {} : { max_tokens: request.max_output_tokens }),
        ...(normalizeTools(request.tools) ? { tools: normalizeTools(request.tools) } : {}),
        ...(request.tool_choice === undefined ? {} : { tool_choice: request.tool_choice }),
      };
      try {
      const result = await coreAdapter.forwardChatCompletion(chatRequest, {
        preferredProviderId: session.providerId || undefined,
        preferredAccountId: session.accountId || undefined,
        responseSession,
        ...(piContext ? { conversationId, piSessionId: piContext.sessionId } : {}),
        // 信号只取服务调用参数；客户端 JSON 中的 signal 不得控制其他会话或污染请求内容。
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const responseId = createResponseId();
      if (!result.stream) {
        const body = createResponseBody({ responseId, conversationId, previousResponseId: request.previous_response_id, request, chatBody: result.body });
        await saveCompleted({ session, conversationId, request, inputMessages, chatBody: result.body, result, responseId, piContext });
        return { body };
      }
      const stream = createResponseStream({ result, responseId, conversationId, previousResponseId: request.previous_response_id, request, session, inputMessages, persist: saveCompleted, piContext });
      if (result.providerId === 'doubaochat' && responseSession.doubaoNodeMode) {
        retainsLease = true;
        return { stream: manageDoubaoStream({ stream, cancel: result.cancel, signal: options.signal,
          timeoutMs: duration - (Date.now() - startedAt), onIncomplete: markUncertain, hasPersisted: () => persisted, release: releaseLease }) };
      }
      return { stream };
      } catch (error) {
        await markUncertain(); throw error;
      }
    };
    // 自定义旧Store保留withLock兼容；生产Store租约允许豆包流返回后仍持锁。
    if (typeof sessionStore.acquireLock !== 'function') return sessionStore.withLock(conversationId, () => operation());
    const lease = await sessionStore.acquireLock(conversationId, { signal: options.signal, timeoutMs: Math.max(1,duration-(Date.now()-startedAt)) });
    try { return await operation(() => lease.release()); }
    finally { if (!retainsLease) lease.release(); }
  };

  const createResponseStream = ({ result, responseId, conversationId, previousResponseId, request, session, inputMessages, persist, piContext }) => {
    const upstream = result.stream[Symbol.asyncIterator]();
    const events = (async function* responseEvents() {
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
    const upstreamIterable = { [Symbol.asyncIterator]: () => upstream };
    for await (const chunk of upstreamIterable) {
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
    await persist({ session, conversationId, request, inputMessages, chatBody: { choices: [{ message: assistantMessage }] }, result, responseId, piContext });
    yield { type: 'response.completed', response: finalBody };
    }());
    return {
      [Symbol.asyncIterator]() { return this; },
      next: () => events.next(),
      return: async () => {
        // 外层可能仍停在 response.created，尚未进入 for-await；显式关闭上游而不是等待下一片。
        try {
          if (typeof upstream.return === 'function') await upstream.return();
        } finally {
          await events.return();
        }
        return { done: true, value: undefined };
      },
    };
  };

  return { createResponse, normalizeInput, normalizeTools };
};

module.exports = { createChat2ApiResponsesService, normalizeInput, normalizeTools };
