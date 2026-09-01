const crypto = require('crypto');
const { prepareManagedToolRequest } = require('./chat2api-tool-calling');

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
    const requestedMapping = await modelMapper.resolveModel(request.model);
    const preferredProviderId = options.preferredProviderId || requestedMapping.preferredProviderId;
    const preferredAccountId = options.preferredAccountId || requestedMapping.preferredAccountId;
    const selection = await loadBalancer.selectAccount(
      request.model,
      'round-robin',
      preferredProviderId,
      preferredAccountId,
    );
    if (!selection) {
      throw createHttpError(503, 'no_available_account', `没有可用的模型账号: ${request.model}`);
    }

    const accountId = selection.account.accountId || selection.account.id;
    const account = await dataStore.getAccount(accountId);
    if (!account) {
      throw createHttpError(503, 'account_not_found', `账号 ${accountId} 不存在`);
    }
    const providerMapping = await modelMapper.resolveModel(request.model, selection.provider);
    const actualModel = selection.actualModel || providerMapping.actualModel || request.model;
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
    const activeProviderIds = new Set(accounts
      .filter((account) => account.enabled !== false && (!account.status || account.status === 'active'))
      .map((account) => account.providerId));
    const data = [];
    const added = new Set();
    for (const provider of providers) {
      if (provider.enabled === false || !activeProviderIds.has(provider.id)) {
        continue;
      }
      const models = provider.supportedModels || Object.keys(provider.modelMappings || {});
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
