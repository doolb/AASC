const crypto = require('crypto');

const createChat2ApiOAuthService = ({ dataStore, providerRegistry, credentialAdapters = {} } = {}) => {
  if (!dataStore || typeof dataStore.createOAuthSession !== 'function' || typeof dataStore.consumeOAuthSession !== 'function' || typeof dataStore.saveAccount !== 'function') {
    throw new Error('Chat2API OAuth 服务需要会话和账号数据存储');
  }
  if (!providerRegistry || typeof providerRegistry.getProvider !== 'function') {
    throw new Error('Chat2API OAuth 服务需要 Provider 注册表');
  }

  const startLogin = async (providerId) => {
    const provider = await providerRegistry.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} 不存在`);
    }
    if (provider.enabled === false) {
      throw new Error(`Provider ${providerId} 未启用`);
    }
    const loginUrl = provider.loginUrl || provider.apiEndpoint;
    const session = await dataStore.createOAuthSession({ providerId: provider.id, loginUrl });
    return {
      state: session.state,
      providerId: provider.id,
      providerName: provider.name,
      loginUrl,
      expiresAt: session.expiresAt,
      credentialFields: provider.credentialFields || [],
    };
  };

  const completeLogin = async ({ state, providerId, credentials, accountId, label, email, accountInfo = {} } = {}) => {
    if (!state || !providerId || !credentials || typeof credentials !== 'object') {
      throw new Error('Chat2API 登录参数不完整');
    }
    const provider = await providerRegistry.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} 不存在`);
    }
    const session = await dataStore.consumeOAuthSession(state, providerId);
    if (!session) {
      throw new Error('登录状态无效、已过期或 Provider 不匹配');
    }
    const adapter = credentialAdapters[provider.id];
    let validated = { valid: true, credentials, accountInfo: {} };
    if (adapter && typeof adapter.validate === 'function') {
      validated = await adapter.validate(credentials, provider);
      if (!validated || validated.valid !== true) {
        throw new Error(validated && validated.error ? validated.error : 'Provider 凭据校验失败');
      }
    }
    const now = Date.now();
    const saved = await dataStore.saveAccount({
      accountId: accountId || `${provider.id}-${crypto.randomBytes(6).toString('hex')}`,
      providerId: provider.id,
      label: label || validated.accountInfo?.name || provider.name,
      email: email || validated.accountInfo?.email || accountInfo.email,
      credentials: validated.credentials || credentials,
      enabled: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...accountInfo,
    });
    return { account: saved };
  };

  const handleCallback = async (query) => {
    const providerId = query && query.providerId;
    const credentials = {};
    if (query && query.token) credentials.token = query.token;
    if (query && query.code) credentials.code = query.code;
    if (query && query.error) throw new Error(query.error_description || query.error);
    return completeLogin({ state: query && query.state, providerId, credentials });
  };

  const cancelLogin = async (state) => {
    if (typeof dataStore.cancelOAuthSession === 'function') {
      await dataStore.cancelOAuthSession(state);
    }
  };

  const stop = async () => {
    if (typeof dataStore.clearOAuthSessions === 'function') {
      await dataStore.clearOAuthSessions();
    }
  };

  return { startLogin, completeLogin, handleCallback, cancelLogin, stop };
};

module.exports = { createChat2ApiOAuthService };
