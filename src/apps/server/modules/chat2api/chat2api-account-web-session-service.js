const crypto = require('crypto');
const { getAndroidLoginProfile } = require('./chat2api-login-profiles');

const DEFAULT_TTL_MS = 2 * 60 * 1000;

const createServiceError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const createChat2ApiAccountWebSessionService = ({ dataStore, providerRegistry, baseUrl, ttlMs = DEFAULT_TTL_MS } = {}) => {
  if (!dataStore || typeof dataStore.getAccount !== 'function') {
    throw new Error('Chat2API 外部网页会话需要账号数据存储');
  }
  if (!providerRegistry || typeof providerRegistry.getProvider !== 'function') {
    throw new Error('Chat2API 外部网页会话需要 Provider 注册表');
  }
  const normalizedBaseUrl = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim().replace(/\/+$/, '') : '';
  if (!normalizedBaseUrl) {
    throw new Error('Chat2API 外部网页会话缺少服务地址');
  }
  const sessions = new Map();

  const removeExpired = () => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (session.expiresAt <= now) sessions.delete(sessionId);
    }
  };

  const toRestorePayload = (account, provider, profile) => {
    const resolvedProfile = profile || { loginUrl: provider.loginUrl || provider.apiEndpoint || '', allowedOrigins: [], cookies: [], localStorage: [] };
    const credentials = account.credentials && typeof account.credentials === 'object' && !Array.isArray(account.credentials)
      ? clone(account.credentials)
      : {};
    const loginUrl = resolvedProfile.loginUrl || provider.loginUrl || provider.apiEndpoint || '';
    const origin = (() => {
      try { return new URL(loginUrl).origin; } catch (_error) { return ''; }
    })();
    const cookieMappings = (resolvedProfile.cookies || []).flatMap((mapping) => {
      const value = credentials[mapping.field];
      if (typeof value !== 'string' || !value.trim()) return [];
      return [{ origin, name: mapping.name, value }];
    });
    const localStorageMappings = (resolvedProfile.localStorage || []).flatMap((mapping) => {
      const value = credentials[mapping.field];
      if (typeof value !== 'string' || !value.trim()) return [];
      return [{ origin, key: mapping.key, value }];
    });
    const allowedOrigins = resolvedProfile.allowedOrigins && resolvedProfile.allowedOrigins.length > 0
      ? resolvedProfile.allowedOrigins
      : (origin ? [origin] : []);
    return {
      loginUrl,
      allowedOrigins: clone(allowedOrigins),
      cookieMappings,
      localStorageMappings,
      credentials,
      cookie: typeof account.cookie === 'string' ? account.cookie : undefined,
      authMethod: account.authMethod,
    };
  };

  const createSession = async (accountId) => {
    removeExpired();
    const account = await dataStore.getAccount(accountId);
    if (!account) throw createServiceError('Chat2API 账号不存在', 404, 'account_not_found');
    if (account.enabled === false) throw createServiceError('Chat2API 账号未启用', 409, 'account_disabled');
    const provider = await providerRegistry.getProvider(account.providerId);
    if (!provider) throw createServiceError('Chat2API Provider 不存在', 404, 'provider_not_found');
    if (provider.enabled === false) throw createServiceError('Chat2API Provider 未启用', 409, 'provider_disabled');
    const profile = getAndroidLoginProfile(provider.id || provider.providerId);
    const loginUrl = profile?.loginUrl || provider.loginUrl || provider.apiEndpoint;
    if (typeof loginUrl !== 'string' || !loginUrl.trim()) {
      throw createServiceError('Chat2API Provider 没有可打开的网页登录地址', 422, 'login_url_unavailable');
    }
    const sessionId = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + Math.max(1_000, Number(ttlMs) || DEFAULT_TTL_MS);
    sessions.set(sessionId, { accountId, providerId: provider.id || provider.providerId, profile, expiresAt });
    return {
      mode: 'account-web',
      sessionId,
      consumeUrl: `${normalizedBaseUrl}/api/chat2api/accounts/web-session/consume`,
      providerId: provider.id || provider.providerId,
      providerName: provider.name || provider.id || provider.providerId,
      loginUrl,
      expiresAt,
    };
  };

  const consumeSession = async (sessionId) => {
    removeExpired();
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw createServiceError('Chat2API 外部网页会话无效', 410, 'web_session_invalid');
    }
    const session = sessions.get(sessionId.trim());
    if (!session) throw createServiceError('Chat2API 外部网页会话已过期或已消费', 410, 'web_session_expired');
    sessions.delete(sessionId.trim());
    if (session.expiresAt <= Date.now()) {
      throw createServiceError('Chat2API 外部网页会话已过期或已消费', 410, 'web_session_expired');
    }
    const account = await dataStore.getAccount(session.accountId);
    if (!account || account.enabled === false) throw createServiceError('Chat2API 账号不可用', 409, 'account_unavailable');
    const provider = await providerRegistry.getProvider(session.providerId);
    if (!provider || provider.enabled === false) throw createServiceError('Chat2API Provider 不可用', 409, 'provider_unavailable');
    return toRestorePayload(account, provider, session.profile);
  };

  const clear = () => sessions.clear();

  return { createSession, consumeSession, clear };
};

module.exports = {
  DEFAULT_TTL_MS,
  createChat2ApiAccountWebSessionService,
};
