const crypto = require('crypto');
const { prepareManagedToolRequest } = require('./chat2api-tool-calling');
const { doubaoError } = require('./chat2api-doubao-chat-adapter');
const {assertTextOnly}=require('./chat2api-content');
const {getSpeechBinding,canonicalProviderId}=require('./chat2api-model-capabilities');

const createHttpError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const createChat2ApiCoreAdapter = ({ dataStore, providerRegistry, modelMapper, loadBalancer, providerAdapters = {} } = {}) => {
  if (!dataStore || typeof dataStore.getAccount !== 'function' || typeof dataStore.listAccounts !== 'function') {
    throw new Error('Chat2API 核心适配层需要账号数据存储');
  }
  if (!providerRegistry || typeof providerRegistry.listProviders !== 'function') {
    throw new Error('Chat2API 核心适配层需要 Provider 注册表');
  }
  if (!modelMapper || typeof modelMapper.resolveModel !== 'function' || !loadBalancer) {
    throw new Error('Chat2API 核心适配层需要模型映射器和负载均衡器');
  }

  const validateRequest = (request) => {
    if (!request || typeof request !== 'object') {
      throw createHttpError(400, 'invalid_request_error', '请求体必须是 JSON 对象');
    }
    if (typeof request.model !== 'string' || request.model.trim().length === 0) {
      throw createHttpError(400, 'invalid_request_error', '缺少必填字段 model');
    }
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw createHttpError(400, 'invalid_request_error', '缺少必填字段 messages');
    }
  };

  const getAdapter = (provider) => {
    const adapter = providerAdapters[provider.id];
    if (typeof adapter === 'function') {
      return adapter;
    }
    if (adapter && typeof adapter.forward === 'function') {
      return adapter.forward.bind(adapter);
    }
    throw createHttpError(501, 'provider_adapter_unavailable', `Provider ${provider.id} 尚未配置适配器`);
  };

  const forwardChatCompletion = async (request, options = {}) => {
    validateRequest(request);
    for(const message of request.messages)assertTextOnly(message?.content);
    const requestedMapping = await modelMapper.resolveModel(request.model);
    if(requestedMapping.application==='tts'||getSpeechBinding(requestedMapping.actualModel,requestedMapping.preferredProviderId,requestedMapping.application))throw createHttpError(400,'unsupported_application','语音模型请使用Responses或speech接口');
    let preferredProviderId = canonicalProviderId(options.preferredProviderId || requestedMapping.preferredProviderId);
    const preferredAccountId = options.preferredAccountId || requestedMapping.preferredAccountId;
    if(['doubao','doubao-think','doubao-expert'].includes(request.model)){
      if(preferredProviderId && preferredProviderId!=='doubaochat')throw doubaoError('doubao_account_conflict');
      preferredProviderId='doubaochat';
    }
    // 凭据包显式配置了Node账号时，未指定账号的豆包请求在发送前只调度Node池。
    // 明确映射的账号仍严格限定；缺资料时提示补全，不偷偷换到其他Node账号。
    const isDoubao = preferredProviderId === 'doubaochat' || ['doubao', 'doubao-think', 'doubao-expert'].includes(request.model);
    let selectionOptions = {};
    if (isDoubao && preferredAccountId) selectionOptions = { requiredAccountId: preferredAccountId, requireSecret: true };
    if (isDoubao && !preferredAccountId && typeof dataStore.listDoubaoNodeAccountIds === 'function') {
      const nodeIds = await dataStore.listDoubaoNodeAccountIds();
      if (nodeIds.length > 0) selectionOptions = { allowedAccountIds: nodeIds, requireSecret: true };
    }
    const selection = await loadBalancer.selectAccount(
      request.model,
      'round-robin',
      preferredProviderId,
      preferredAccountId,
      ...(isDoubao ? [selectionOptions] : []),
    );
    if (!selection) {
      throw createHttpError(503, 'no_available_account', `没有可用的模型账号: ${request.model}；请先在 Chat2API 登录对应账号，或恢复已有登录资料`);
    }

    // 豆包文字只支持Node；旧Cookie-only账号在发送前要求补齐，已保存网页开关不再读取。
    let selectedDoubaoAccount;
    if (selection.provider.id === 'doubaochat') {
      selectedDoubaoAccount = await dataStore.getAccount(selection.account.accountId || selection.account.id);
    }
    const nodeMode = selectedDoubaoAccount?.credentials && Object.hasOwn(selectedDoubaoAccount.credentials, 'nodeProfile');
    if(selection.provider.id==='doubaochat'){
      if(preferredAccountId && preferredAccountId !== (selection.account.accountId || selection.account.id)) throw doubaoError('doubao_account_conflict');
      if(!nodeMode)throw doubaoError('doubao_node_profile_required');
    }

    const accountId = selection.account.accountId || selection.account.id;
    const account = selectedDoubaoAccount && (selectedDoubaoAccount.accountId || selectedDoubaoAccount.id) === accountId
      ? selectedDoubaoAccount : await dataStore.getAccount(accountId);
    if (!account || (selection.provider.id==='doubaochat' && (account.providerId !== selection.provider.id || account.enabled === false || (account.status && account.status !== 'active')))) {
      throw createHttpError(503, 'account_not_found', `账号 ${accountId} 不存在`);
    }
    const providerMapping = await modelMapper.resolveModel(request.model, selection.provider);
    const actualModel = selection.actualModel || providerMapping.actualModel || request.model;
    const bound=options.responseSession?.boundModel;
    if(bound&&((bound.providerId!=='doubaochat'&&bound.model&&actualModel!==bound.model)||(requestedMapping.preferredProviderId&&canonicalProviderId(requestedMapping.preferredProviderId)!==bound.providerId)
      ||(requestedMapping.preferredAccountId&&requestedMapping.preferredAccountId!==bound.accountId)))throw createHttpError(400,'conversation_model_conflict','会话绑定与当前模型映射不一致，请新建会话');
    const providerRequest = prepareManagedToolRequest({
      ...request,
      model: actualModel,
      originalModel: request.model,
    }, options.responseSession);
    const context = {
      requestId: `chatcmpl-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
      providerId: selection.provider.id,
      accountId,
      model: request.model,
      actualModel,
      isStream: request.stream === true,
      startTime: Date.now(),
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.piSessionId ? { piSessionId: options.piSessionId } : {}),
      // HTTP 响应断连信号只放在内部 context，不混进模型请求体或持久化会话。
      ...(options.signal ? { signal: options.signal } : {}),
    };

    try {
      const result = await getAdapter(selection.provider)({
        request: providerRequest,
        account,
        provider: selection.provider,
        actualModel,
        context,
        responseSession: options.responseSession,
      });
      if (!result || (!result.body && !result.stream)) {
        throw new Error('Provider adapter 返回了空结果');
      }
      if (result.body) {
        return {
          ...result,
          body: { ...result.body, model: result.body.model || request.model },
          nativeState: result.nativeState || options.responseSession?.nativeState || {},
          providerId: selection.provider.id,
          accountId,
          actualModel,
        };
      }
      return {
        ...result,
        nativeState: result.nativeState || options.responseSession?.nativeState || {},
        providerId: selection.provider.id,
        accountId,
        actualModel,
      };
    } catch (error) {
      if (typeof loadBalancer.markAccountFailed === 'function') {
        loadBalancer.markAccountFailed(accountId);
      }
      if (error.statusCode) {
        throw error;
      }
      throw createHttpError(502, 'provider_request_failed', `Provider 请求失败: ${error.message}`);
    }
  };

  const listModels = async () => {
    const providers = await providerRegistry.listProviders();
    const accounts = await dataStore.listAccounts();
    const mappings = dataStore.listEffectiveModelMappings ? await dataStore.listEffectiveModelMappings() : [];
    const activeProviderIds = new Set(accounts
      .filter((account) => account.enabled !== false && (!account.status || account.status === 'active'))
      .map((account) => account.providerId));
    const data = [];
    const added = new Set();
    for (const provider of providers) {
      if (provider.enabled === false || !activeProviderIds.has(provider.id)) {
        continue;
      }
      const aliases = mappings.filter(rule => canonicalProviderId(rule.preferredProviderId || rule.providerId) === provider.id
        && !rule.model.includes('*') && rule.application !== 'tts' && !getSpeechBinding(rule.actualModel, provider.id, rule.application)).map(rule => rule.model);
      const models = [...(provider.supportedModels || Object.keys(provider.modelMappings || {})), ...aliases];
      for (const id of models) {
        if (!added.has(id)) {
          added.add(id);
          data.push({ id, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: provider.name });
        }
      }
    }
    return { object: 'list', data };
  };

  return { forwardChatCompletion, listModels, createHttpError };
};

module.exports = { createChat2ApiCoreAdapter, createHttpError };
