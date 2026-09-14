const crypto = require('crypto');
const { sanitizeSecrets } = require('./chat2api-secret');

// 这些规则来自 Chat2API 的网页登录捕获/手动添加适配器，只映射已确认的字段，避免把未知 Cookie 猜测成 Token。
const MANUAL_COOKIE_MAPPINGS = Object.freeze({
  mimo: Object.freeze([
    { cookieName: 'serviceToken', credentialName: 'service_token' },
    { cookieName: 'userId', credentialName: 'user_id' },
    { cookieName: 'xiaomichatbot_ph', credentialName: 'ph_token' },
  ]),
  perplexity: Object.freeze([
    { cookieName: '__Secure-next-auth.session-token', credentialName: 'sessionToken' },
    { cookieName: 'next-auth.session-token', credentialName: 'sessionToken' },
  ]),
  qwen: Object.freeze([{ cookieName: 'tongyi_sso_ticket', credentialName: 'ticket' }]),
});

const COOKIE_ATTRIBUTES = new Set([
  'domain', 'expires', 'httponly', 'max-age', 'path', 'samesite', 'secure',
]);

const createServiceError = (message, statusCode = 400, code = 'invalid_request') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const parseCookieHeader = (cookieHeader) => {
  if (typeof cookieHeader !== 'string' || cookieHeader.trim().length === 0) {
    throw createServiceError('Cookie 不能为空');
  }
  let source = cookieHeader.trim();
  source = source.replace(/^Cookie\s*:\s*/i, '');
  const cookies = {};
  for (const segment of source.split(';')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (!name || !value || COOKIE_ATTRIBUTES.has(name.toLowerCase())) {
      continue;
    }
    cookies[name] = value;
  }
  if (Object.keys(cookies).length === 0) {
    throw createServiceError('Cookie 格式无效');
  }
  return cookies;
};

const extractManualCredentials = (providerId, input = {}) => {
  if (!input || typeof input !== 'object') {
    throw createServiceError('手动认证参数必须是对象');
  }
  if (input.credentials !== undefined && (!input.credentials || typeof input.credentials !== 'object' || Array.isArray(input.credentials))) {
    throw createServiceError('手动认证凭据必须是对象');
  }
  const credentials = { ...(input.credentials || {}) };
  const cookieHeader = typeof input.cookie === 'string' ? input.cookie.trim() : '';
  if (!cookieHeader) {
    return credentials;
  }
  const cookies = parseCookieHeader(cookieHeader);
  for (const mapping of MANUAL_COOKIE_MAPPINGS[providerId] || []) {
    if (typeof cookies[mapping.cookieName] === 'string' && cookies[mapping.cookieName].length > 0) {
      credentials[mapping.credentialName] = cookies[mapping.cookieName];
    }
  }
  if (input.authMethod === 'cookie' && !(MANUAL_COOKIE_MAPPINGS[providerId] || []).length) {
    // 自定义 cookie Provider 没有专属字段映射时，保留完整 Cookie 交给通用适配器。
    credentials.cookie = cookieHeader;
  }
  return credentials;
};

const validateRequiredFields = (provider, credentials) => {
  const requiredFields = (provider.credentialFields || []).filter((field) => field.required).map((field) => field.name);
  const missing = requiredFields.filter((field) => typeof credentials[field] !== 'string' || credentials[field].trim().length === 0);
  if (missing.length > 0) {
    throw createServiceError(`缺少必填凭据字段: ${missing.join(', ')}`, 422, 'missing_credentials');
  }
};

const getSupportedManualMethods = (provider) => {
  const declared = Array.isArray(provider.authMethods) && provider.authMethods.length > 0
    ? provider.authMethods
    : ['manual'];
  if ((MANUAL_COOKIE_MAPPINGS[provider.id] || provider.authType === 'cookie') && !declared.includes('cookie')) {
    return [...declared, 'cookie'];
  }
  return declared;
};

const createChat2ApiManualAccountService = ({ dataStore, providerRegistry, credentialAdapters = {} } = {}) => {
  if (!dataStore || typeof dataStore.saveAccount !== 'function') {
    throw new Error('Chat2API 手动账号服务需要账号数据存储');
  }
  if (!providerRegistry || typeof providerRegistry.getProvider !== 'function') {
    throw new Error('Chat2API 手动账号服务需要 Provider 注册表');
  }

  const addManualAccount = async ({ providerId, credentials, cookie, authMethod, accountId, label, email, accountInfo = {} } = {}) => {
    if (typeof providerId !== 'string' || providerId.trim().length === 0) {
      throw createServiceError('Chat2API 手动认证缺少 Provider', 400, 'missing_provider');
    }
    const provider = await providerRegistry.getProvider(providerId.trim());
    if (!provider) {
      throw createServiceError(`Provider ${providerId} 不存在`, 404, 'provider_not_found');
    }
    if (provider.enabled === false) {
      throw createServiceError(`Provider ${providerId} 未启用`, 422, 'provider_disabled');
    }
    // 统一认证表单不再要求前端选择方式：粘贴 Cookie 时自动走 cookie，只有填写字段时才走 manual。
    const normalizedAuthMethod = typeof authMethod === 'string' && authMethod.trim()
      ? authMethod.trim()
      : (typeof cookie === 'string' && cookie.trim() ? 'cookie' : 'manual');
    if (normalizedAuthMethod === 'external') {
      throw createServiceError('外部登录不能通过手动接口，请使用 Android 隔离 WebView', 422, 'external_login_not_manual');
    }
    if (!getSupportedManualMethods(provider).includes(normalizedAuthMethod)) {
      throw createServiceError(`Provider ${providerId} 不支持 ${normalizedAuthMethod === 'cookie' ? 'Cookie' : '该'} 认证`, 422, 'auth_method_not_supported');
    }
    const normalizedCredentials = extractManualCredentials(provider.id, { credentials, cookie, authMethod: normalizedAuthMethod });
    // 先做本地必填校验，避免缺字段时无意义地调用供应商接口。
    validateRequiredFields(provider, normalizedCredentials);
    const adapter = credentialAdapters[provider.id];
    let validated = { valid: true, credentials: normalizedCredentials, accountInfo: {} };
    if (adapter && typeof adapter.validate === 'function') {
      try {
        validated = await adapter.validate(normalizedCredentials, provider);
      } catch (error) {
        error.statusCode = error.statusCode || 422;
        error.code = error.code || 'credential_validation_failed';
        throw error;
      }
      if (!validated || validated.valid !== true) {
        throw createServiceError(validated && validated.error ? validated.error : 'Provider 凭据校验失败', 422, 'credential_validation_failed');
      }
    }
    const now = Date.now();
    const saved = await dataStore.saveAccount({
      accountId: accountId || `${provider.id}-${crypto.randomBytes(6).toString('hex')}`,
      providerId: provider.id,
      label: label || validated.accountInfo?.name || provider.name,
      email: email || validated.accountInfo?.email || accountInfo.email,
      credentials: validated.credentials || normalizedCredentials,
      enabled: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...accountInfo,
    });
    return { account: sanitizeSecrets(saved) };
  };

  return { addManualAccount };
};

module.exports = {
  MANUAL_COOKIE_MAPPINGS,
  createChat2ApiManualAccountService,
  extractManualCredentials,
  parseCookieHeader,
};
