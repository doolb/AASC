const crypto = require('crypto');
const { getAndroidLoginProfile } = require('./chat2api-login-profiles');
const { getQwenCredential } = require('./chat2api-speech-service');
const { parseCookies } = require('./chat2api-qwen-speech-auth');
const { DOUBAO_COOKIE_ORIGINS, parseDoubaoCookieHeader } = require('./chat2api-doubao-cookie-snapshot');

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
  const refreshSessions = new Map();

  const removeExpired = () => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (session.expiresAt <= now) sessions.delete(sessionId);
    }
    for (const [token, session] of refreshSessions.entries()) {
      if (session.expiresAt <= now) refreshSessions.delete(token);
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
    const allowedOrigins = resolvedProfile.allowedOrigins && resolvedProfile.allowedOrigins.length > 0
      ? resolvedProfile.allowedOrigins
      : (origin ? [origin] : []);
    if ((provider.id || provider.providerId) === 'qwen') {
      // 复用Chat2API当前ticket/Cookie规则；缺少凭证仍可打开网页手动登录，不打印原始值。
      try { credentials.ticket = parseCookies(getQwenCredential(account)).find(item => item.name === 'tongyi_sso_ticket')?.value; }
      catch (_error) { delete credentials.ticket; }
    }
    const mappedCookies = (resolvedProfile.cookies || []).flatMap((mapping) => {
      const value = credentials[mapping.field];
      if (typeof value !== 'string' || !value.trim()) return [];
      const targets = Array.isArray(mapping.origins) ? mapping.origins : [origin];
      return [...new Set(targets)].filter(target => allowedOrigins.includes(target))
        .map(target => ({ origin: target, name: mapping.name, value }));
    });
    // Cookie集合与Android登录捕获使用同一声明，恢复时只写入白名单名称和允许来源。
    const bundledCookies = (resolvedProfile.cookieBundles || []).flatMap((bundle) => {
      const value = credentials[bundle.field];
      if (typeof value !== 'string' || !value.trim()) return [];
      const allowedNames = new Set(bundle.names || []);
      // 集合Cookie沿用单Cookie的显式来源约束；未声明时保持旧的登录来源默认值。
      // 只生成固定允许来源的host-only恢复项，不扩大到父域或账号自带的其他Cookie名称。
      const targets = Array.isArray(bundle.origins) ? bundle.origins : [origin];
      const validTargets = [...new Set(targets)].filter(target => allowedOrigins.includes(target));
      return parseCookies(value).filter(item => allowedNames.has(item.name))
        .flatMap(item => validTargets.map(target => ({ origin: target, name: item.name, value: item.value })));
    });
    const snapshot = (provider.id || provider.providerId) === 'doubaochat' ? credentials.cookieSnapshot : null;
    const snapshotCookies = DOUBAO_COOKIE_ORIGINS.flatMap(target => {
      if (!snapshot?.[target]) return [];
      const selected = new Map();
      // Android CookieManager 只能按URL写入，不能重建同名Cookie原有的Path/Domain；首项用于网页恢复。
      for (const { name, value } of parseDoubaoCookieHeader(snapshot[target])) {
        if (!selected.has(name)) selected.set(name, value);
      }
      return [...selected].map(([name, value]) => ({ origin: target, name, value }));
    });
    const cookieMappings = [...mappedCookies, ...bundledCookies].filter(item => !snapshot?.[item.origin]).concat(snapshotCookies);
    const localStorageMappings = (resolvedProfile.localStorage || []).flatMap((mapping) => {
      const value = credentials[mapping.field];
      if (typeof value !== 'string' || !value.trim()) return [];
      return [{ origin, key: mapping.key, value }];
    });
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
    const payload = toRestorePayload(account, provider, session.profile);
    if (session.providerId === 'doubaochat') {
      const refreshToken = crypto.randomBytes(24).toString('hex');
      refreshSessions.set(refreshToken, { accountId: session.accountId,
        credentialRevision: account.credentialRevision, expiresAt: Date.now() + Math.max(60_000, ttlMs) });
      payload.refreshUrl = `${normalizedBaseUrl}/api/chat2api/accounts/web-session/refresh`;
      payload.refreshToken = refreshToken;
    }
    return payload;
  };

  const refreshCredentials = async (refreshToken, cookieSnapshot, requestProfile) => {
    removeExpired();
    const session = refreshSessions.get(refreshToken);
    if (!session) throw createServiceError('豆包外部网页刷新会话已过期', 410, 'web_session_expired');
    if (typeof dataStore.refreshDoubaoCookieSnapshot !== 'function') {
      throw createServiceError('豆包账号刷新不可用', 503, 'web_session_unavailable');
    }
    const result = requestProfile === undefined
      ? await dataStore.refreshDoubaoCookieSnapshot(session.accountId, session.credentialRevision, cookieSnapshot)
      : await dataStore.refreshDoubaoCookieSnapshot(session.accountId, session.credentialRevision, cookieSnapshot, requestProfile);
    refreshSessions.delete(refreshToken);
    return result;
  };

  const clear = () => { sessions.clear(); refreshSessions.clear(); };

  return { createSession, consumeSession, refreshCredentials, clear };
};

module.exports = {
  DEFAULT_TTL_MS,
  createChat2ApiAccountWebSessionService,
};
