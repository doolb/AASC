const BUILTIN_PROVIDERS = Object.freeze([
  {
    id: 'deepseek', name: 'DeepSeek', authType: 'userToken', apiEndpoint: 'https://chat.deepseek.com/api', chatPath: '/v0/chat/completion',
    supportedModels: ['deepseek-v4-flash', 'deepseek-v4-pro'], modelMappings: { 'deepseek-v4-flash': 'deepseek-v4-flash', 'deepseek-v4-pro': 'deepseek-v4-pro' }, credentialFields: [{ name: 'token', label: 'User Token', type: 'password', required: true }],
  },
  {
    id: 'glm', name: 'GLM', authType: 'refresh_token', apiEndpoint: 'https://chatglm.cn/api', chatPath: '/chatglm/backend-api/assistant/stream',
    supportedModels: ['GLM-5.1'], modelMappings: { 'GLM-5.1': 'glm-5.1' }, credentialFields: [{ name: 'refresh_token', label: 'Refresh Token', type: 'password', required: true }],
  },
  {
    id: 'kimi', name: 'Kimi', authType: 'jwt', apiEndpoint: 'https://www.kimi.com', chatPath: '/apiv2/kimi.gateway.chat.v1.ChatService/Chat',
    supportedModels: ['Kimi-K2.6'], modelMappings: { 'Kimi-K2.6': 'kimi-k2.6' }, credentialFields: [{ name: 'token', label: '访问令牌', type: 'password', required: true }],
  },
  {
    id: 'minimax', name: 'MiniMax', authType: 'jwt', apiEndpoint: 'https://agent.minimaxi.com', chatPath: '/matrix/api/v1/chat/send_msg',
    supportedModels: ['MiniMax-M2.7'], modelMappings: { 'MiniMax-M2.7': 'MiniMax-M2.7' }, credentialFields: [{ name: 'token', label: 'JWT Token', type: 'password', required: true }, { name: 'realUserID', label: 'Real User ID', type: 'text', required: false }],
  },
  {
    id: 'mimo', name: 'Mimo', authType: 'cookie', apiEndpoint: 'https://aistudio.xiaomimimo.com', chatPath: '/open-apis/bot/chat',
    supportedModels: ['MiMo-V2.5-Pro', 'MiMo-V2.5', 'MiMo-V2-Flash'], modelMappings: { 'MiMo-V2.5-Pro': 'mimo-v2.5-pro', 'MiMo-V2.5': 'mimo-v2.5', 'MiMo-V2-Flash': 'mimo-v2-flash' }, credentialFields: [{ name: 'service_token', label: 'Service Token', type: 'password', required: true }, { name: 'user_id', label: 'User ID', type: 'text', required: true }, { name: 'ph_token', label: 'PH Token', type: 'password', required: true }],
  },
  {
    id: 'perplexity', name: 'Perplexity', authType: 'cookie', apiEndpoint: 'https://www.perplexity.ai', chatPath: '/rest/sse/perplexity_ask',
    supportedModels: ['Auto'], modelMappings: { Auto: 'auto' }, credentialFields: [{ name: 'sessionToken', label: 'Session Token', type: 'password', required: true }],
  },
  {
    id: 'qwen', name: 'Qwen', authType: 'tongyi_sso_ticket', apiEndpoint: 'https://chat2.qianwen.com', historyApiEndpoint: 'https://chat2-api.qianwen.com', chatPath: '/api/v2/chat',
    supportedModels: ['Qwen3.6', 'Qwen3.7-Max', 'Qwen3.5-Flash', 'Qwen3-Max', 'Qwen3-Max-Thinking-Preview', 'Qwen3-Coder'],
    modelMappings: { 'Qwen3.6': 'Qwen', 'Qwen3.7-Max': 'Qwen3.7-Max', 'Qwen3.5-Flash': 'Qwen3.5-Flash', 'Qwen3-Max': 'Qwen3-Max', 'Qwen3-Max-Thinking-Preview': 'Qwen3-Max-Thinking-Preview', 'Qwen3-Coder': 'Qwen3-Coder' }, credentialFields: [{ name: 'ticket', label: 'SSO Ticket', type: 'password', required: true }],
  },
  {
    id: 'qwen-ai', name: 'Qwen AI (International)', authType: 'jwt', apiEndpoint: 'https://chat.qwen.ai', chatPath: '/api/v2/chat/completions',
    supportedModels: ['Qwen3.7-Max', 'Qwen3.6-Plus', 'Qwen3.6-35B-A3B', 'Qwen3.6-27B', 'Qwen3-Coder'],
    modelMappings: { 'Qwen3.7-Max': 'qwen3.7-max', 'Qwen3.6-Plus': 'qwen3.6-plus', 'Qwen3.6-35B-A3B': 'qwen3.6-35b-a3b', 'Qwen3.6-27B': 'qwen3.6-27b', 'Qwen3-Coder': 'qwen3-coder-plus' }, credentialFields: [{ name: 'token', label: 'Auth Token', type: 'password', required: true }, { name: 'cookies', label: 'Cookies', type: 'textarea', required: false }],
  },
  {
    id: 'zai', name: 'Z.ai', authType: 'jwt', apiEndpoint: 'https://chat.z.ai/api', chatPath: '/v2/chat/completions',
    supportedModels: ['GLM-5.1', 'GLM-5-Turbo', 'GLM-5V-Turbo', 'GLM-5', 'GLM-4.7'],
    modelMappings: { 'GLM-5.1': 'GLM-5.1', 'GLM-5-Turbo': 'GLM-5-Turbo', 'GLM-5V-Turbo': 'GLM-5v-Turbo', 'GLM-5': 'glm-5', 'GLM-4.7': 'glm-4.7' }, credentialFields: [{ name: 'token', label: 'Access Token', type: 'password', required: true }, { name: 'captcha_verify_param', label: 'Captcha Verify Param', type: 'password', required: false }],
  },
]);

const clone = (value) => JSON.parse(JSON.stringify(value));

const getProviderId = (provider) => provider && (provider.providerId || provider.id);

const createChat2ApiProviderRegistry = ({ dataStore } = {}) => {
  if (!dataStore || typeof dataStore.readCollection !== 'function' || typeof dataStore.writeCollection !== 'function') {
    throw new Error('Chat2API Provider 注册表需要可读写的数据存储');
  }

  const normalizeStoredProvider = (provider) => {
    const providerId = getProviderId(provider);
    if (!providerId) {
      throw new Error('Chat2API Provider 缺少 providerId');
    }
    return { ...clone(provider), providerId, id: providerId };
  };

  const getStoredProviders = async () => {
    const stored = await dataStore.readCollection('providers', []);
    if (!Array.isArray(stored)) {
      throw new Error('Chat2API Provider 数据必须是数组');
    }
    return stored.map(normalizeStoredProvider);
  };

  const listProviders = async () => {
    const stored = await getStoredProviders();
    const storedById = new Map(stored.map((provider) => [provider.id, provider]));
    const providers = BUILTIN_PROVIDERS.map((builtin) => ({
      ...clone(builtin),
      type: 'builtin',
      enabled: true,
      headers: {},
      ...storedById.get(builtin.id),
      id: builtin.id,
      providerId: builtin.id,
    }));
    const builtinIds = new Set(BUILTIN_PROVIDERS.map((provider) => provider.id));
    const customProviders = stored.filter((provider) => !builtinIds.has(provider.id));
    return [...providers, ...customProviders.map((provider) => ({
      type: 'custom',
      enabled: true,
      headers: {},
      supportedModels: [],
      modelMappings: {},
      ...provider,
    }))];
  };

  const getProvider = async (providerId) => {
    const providers = await listProviders();
    return providers.find((provider) => provider.id === providerId) || null;
  };

  const validateProvider = (provider) => {
    const normalizedId = getProviderId(provider);
    if (typeof normalizedId !== 'string' || normalizedId.trim().length === 0) {
      throw new Error('Chat2API Provider 缺少有效的 providerId');
    }
    if (typeof provider.name !== 'string' || provider.name.trim().length === 0) {
      throw new Error('Chat2API Provider 缺少有效的名称');
    }
    try {
      const url = new URL(provider.apiEndpoint);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('协议不支持');
      }
    } catch (error) {
      throw new Error(`Chat2API Provider 接口地址无效: ${error.message}`);
    }
    return { ...clone(provider), providerId: normalizedId.trim(), id: normalizedId.trim() };
  };

  const saveProvider = async (provider) => {
    const normalized = validateProvider(provider);
    const stored = await getStoredProviders();
    const next = [...stored.filter((item) => item.id !== normalized.id), normalized];
    await dataStore.writeCollection('providers', next);
    return (await getProvider(normalized.id));
  };

  const deleteProvider = async (providerId, related = {}) => {
    if ((related.accounts || []).some((account) => account.providerId === providerId)
      || (related.mappings || []).some((mapping) => mapping.providerId === providerId || mapping.preferredProviderId === providerId)) {
      return false;
    }
    const stored = await getStoredProviders();
    const next = stored.filter((provider) => provider.id !== providerId);
    if (next.length === stored.length) return false;
    await dataStore.writeCollection('providers', next);
    return true;
  };

  const listModels = async () => {
    const models = new Set();
    for (const provider of await listProviders()) {
      if (provider.enabled === false) {
        continue;
      }
      for (const model of provider.supportedModels || Object.keys(provider.modelMappings || {})) {
        models.add(model);
      }
    }
    return [...models];
  };

  const getEffectiveModels = (provider) => {
    const names = provider.supportedModels || Object.keys(provider.modelMappings || {});
    return names.map((displayName) => ({
      displayName,
      actualModelId: (provider.modelMappings || {})[displayName] || displayName,
    }));
  };

  return {
    listProviders,
    getProvider,
    saveProvider,
    deleteProvider,
    listModels,
    getEffectiveModels,
  };
};

module.exports = {
  BUILTIN_PROVIDERS,
  createChat2ApiProviderRegistry,
};
