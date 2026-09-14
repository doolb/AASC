const axios = require('axios');
const crypto = require('crypto');

const VALIDATION_TIMEOUT_MS = 15 * 1000;

const getProviderId = (provider) => provider && (provider.id || provider.providerId);

const getCredentials = (credentials) => credentials && typeof credentials === 'object' ? credentials : {};

const hasValue = (value) => typeof value === 'string' && value.trim().length > 0;

const failure = (error = 'Provider 凭据校验失败') => ({ valid: false, error });

const request = async (httpClient, config) => {
  try {
    return await httpClient.request({
      timeout: VALIDATION_TIMEOUT_MS,
      validateStatus: () => true,
      ...config,
    });
  } catch (error) {
    return { error };
  }
};

const getError = (response) => {
  if (!response || !response.error) {
    return 'Provider 验证请求失败';
  }
  // 不将 Axios 的完整错误对象返回给控制端，避免错误消息意外带出请求头或 URL 参数中的凭据。
  return 'Provider 验证请求失败，请检查网络连接';
};

const getData = (response) => response && response.data && typeof response.data === 'object' ? response.data : {};

const isSuccessStatus = (response) => Number(response && response.status) >= 200 && Number(response.status) < 300;

const buildCookie = (entries) => Object.entries(entries)
  .filter(([, value]) => hasValue(value))
  .map(([key, value]) => `${key}=${value}`)
  .join('; ');

const extractMiniMaxUserId = (credentials) => {
  if (hasValue(credentials.realUserID)) {
    return credentials.realUserID.trim();
  }
  const token = credentials.token || '';
  const payload = String(token).split('.')[1];
  if (!payload) {
    return '';
  }
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return String(parsed.user?.id || parsed.id || parsed.sub || '');
  } catch {
    return '';
  }
};

const validateDeepSeek = async (credentials, httpClient) => {
  if (!hasValue(credentials.token)) return failure('缺少必填凭据字段: token');
  const response = await request(httpClient, {
    method: 'GET',
    url: 'https://chat.deepseek.com/api/v0/users/current',
    headers: { Authorization: `Bearer ${credentials.token}`, Accept: '*/*', Origin: 'https://chat.deepseek.com' },
  });
  if (response.error) return failure(getError(response));
  const data = getData(response);
  if (response.status === 200 && data.code === 0 && data.data?.biz_data) {
    return { valid: true, credentials, accountInfo: { email: data.data.biz_data.email, name: data.data.biz_data.id_profile?.name } };
  }
  return failure(response.status === 401 ? 'Token 已过期或无效' : 'DeepSeek 凭据校验失败');
};

const validateGlm = async (credentials, httpClient) => {
  if (!hasValue(credentials.refresh_token)) return failure('缺少必填凭据字段: refresh_token');
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const sign = crypto.createHash('md5').update(`${timestamp}-${nonce}-8a1317a7468aa3ad86e997d08f3f31cb`).digest('hex');
  const response = await request(httpClient, {
    method: 'POST',
    url: 'https://chatglm.cn/chatglm/user-api/user/refresh',
    data: {},
    headers: {
      Authorization: `Bearer ${credentials.refresh_token}`,
      'Content-Type': 'application/json',
      'X-Device-Id': crypto.randomUUID().replaceAll('-', ''),
      'X-Nonce': nonce,
      'X-Request-Id': crypto.randomUUID(),
      'X-Sign': sign,
      'X-Timestamp': timestamp,
      Origin: 'https://chatglm.cn',
    },
  });
  if (response.error) return failure(getError(response));
  const data = getData(response);
  if (isSuccessStatus(response) && data.result?.access_token) {
    return { valid: true, credentials, accountInfo: { name: data.result.user?.name } };
  }
  return failure(response.status === 401 ? 'Token 已过期或无效' : 'GLM 凭据校验失败');
};

const validateKimi = async (credentials, httpClient) => {
  if (!hasValue(credentials.token)) return failure('缺少必填凭据字段: token');
  const response = await request(httpClient, {
    method: 'POST',
    url: 'https://www.kimi.com/apiv2/kimi.gateway.order.v1.SubscriptionService/GetSubscription',
    data: {},
    headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json', Origin: 'https://www.kimi.com' },
  });
  if (response.error) return failure(getError(response));
  const data = getData(response);
  if (response.status === 200 && data.subscription) {
    return { valid: true, credentials, accountInfo: { name: data.subscription.userName } };
  }
  return failure('Kimi 凭据校验失败');
};

const validateMiniMax = async (credentials, httpClient) => {
  if (!hasValue(credentials.token)) return failure('缺少必填凭据字段: token');
  const realUserID = extractMiniMaxUserId(credentials);
  if (!realUserID) return failure('无法从 MiniMax 凭据中提取用户 ID');
  const timestamp = Math.floor(Date.now() / 1000);
  const data = JSON.stringify({ uuid: realUserID });
  const signature = crypto.createHash('md5').update(`${timestamp}${credentials.token}${data}`).digest('hex');
  const query = new URLSearchParams({ device_platform: 'web', biz_id: '3', app_id: '3001', version_code: '22201', uuid: realUserID, user_id: realUserID });
  const response = await request(httpClient, {
    method: 'POST',
    url: `https://agent.minimaxi.com/v1/api/user/device/register?${query}`,
    data: { uuid: realUserID },
    headers: { token: credentials.token, 'x-timestamp': String(timestamp), 'x-signature': signature, 'Content-Type': 'application/json', Origin: 'https://agent.minimaxi.com' },
  });
  if (response.error) return failure(getError(response));
  const responseData = getData(response);
  if (response.status === 200 && responseData.data?.deviceIDStr) {
    return { valid: true, credentials, accountInfo: { name: responseData.data.userInfo?.name || responseData.data.userInfo?.nickname, email: responseData.data.userInfo?.email } };
  }
  return failure('MiniMax 凭据校验失败');
};

const validateMimo = async (credentials, httpClient) => {
  const required = ['service_token', 'user_id', 'ph_token'];
  const missing = required.filter((field) => !hasValue(credentials[field]));
  if (missing.length > 0) return failure(`缺少必填凭据字段: ${missing.join(', ')}`);
  const response = await request(httpClient, {
    method: 'GET',
    url: 'https://aistudio.xiaomimimo.com/',
    headers: { Cookie: buildCookie({ serviceToken: credentials.service_token, userId: credentials.user_id, xiaomichatbot_ph: credentials.ph_token }), Origin: 'https://aistudio.xiaomimimo.com' },
  });
  if (response.error) return failure(getError(response));
  // Mimo 当前没有公开的只读账号检查接口，站点入口会根据 Cookie 返回登录态页面。
  return isSuccessStatus(response) ? { valid: true, credentials, accountInfo: { name: 'Mimo User' } } : failure('Mimo 凭据校验失败');
};

const validatePerplexity = async (credentials, httpClient) => {
  if (!hasValue(credentials.sessionToken)) return failure('缺少必填凭据字段: sessionToken');
  const response = await request(httpClient, {
    method: 'GET',
    url: 'https://www.perplexity.ai/api/auth/session',
    headers: { Cookie: `__Secure-next-auth.session-token=${credentials.sessionToken}`, Accept: 'application/json', Origin: 'https://www.perplexity.ai' },
  });
  if (response.error) return failure(getError(response));
  if (isSuccessStatus(response) && getData(response).user) return { valid: true, credentials, accountInfo: { name: getData(response).user.name, email: getData(response).user.email } };
  return failure('Perplexity 凭据校验失败');
};

const validateQwen = async (credentials, httpClient) => {
  if (!hasValue(credentials.ticket)) return failure('缺少必填凭据字段: ticket');
  const response = await request(httpClient, {
    method: 'POST',
    url: 'https://chat2-api.qianwen.com/api/v2/session/page/list',
    data: {},
    headers: { Cookie: `tongyi_sso_ticket=${credentials.ticket}`, 'Content-Type': 'application/json', Origin: 'https://www.qianwen.com', Referer: 'https://www.qianwen.com/' },
    params: { biz_id: 'ai_qwen', chat_client: 'h5', device: 'pc', fr: 'pc', pr: 'qwen', ut: crypto.randomUUID().replaceAll('-', '') },
  });
  if (response.error) return failure(getError(response));
  if (response.status === 200 && getData(response).success) return { valid: true, credentials };
  return failure('Qwen SSO Ticket 校验失败');
};

const validateQwenAi = async (credentials, httpClient) => {
  if (!hasValue(credentials.token)) return failure('缺少必填凭据字段: token');
  const response = await request(httpClient, {
    method: 'GET',
    url: 'https://chat.qwen.ai/api/v2/user',
    headers: { Authorization: `Bearer ${credentials.token}`, Accept: 'application/json', source: 'web' },
  });
  if (response.error) return failure(getError(response));
  const data = getData(response);
  if (response.status === 200 && data.data) return { valid: true, credentials, accountInfo: { name: data.data.name || data.data.email, email: data.data.email } };
  return failure('Qwen AI 凭据校验失败');
};

const validateZai = async (credentials, httpClient) => {
  if (!hasValue(credentials.token)) return failure('缺少必填凭据字段: token');
  const response = await request(httpClient, {
    method: 'GET',
    url: 'https://chat.z.ai/api/v1/users/user/settings',
    headers: { Authorization: `Bearer ${credentials.token}`, Accept: '*/*', Origin: 'https://chat.z.ai' },
  });
  if (response.error) return failure(getError(response));
  if (isSuccessStatus(response)) return { valid: true, credentials, accountInfo: { name: getData(response).data?.name || getData(response).data?.nickname } };
  return failure(response.status === 401 ? 'Token 已过期或无效' : 'Z.ai 凭据校验失败');
};

const VALIDATORS = Object.freeze({
  deepseek: validateDeepSeek,
  glm: validateGlm,
  kimi: validateKimi,
  minimax: validateMiniMax,
  mimo: validateMimo,
  perplexity: validatePerplexity,
  qwen: validateQwen,
  'qwen-ai': validateQwenAi,
  zai: validateZai,
});

const createChat2ApiCredentialValidators = ({ httpClient = axios } = {}) => Object.fromEntries(
  Object.entries(VALIDATORS).map(([providerId, validate]) => [providerId, {
    validate: async (credentials, provider) => {
      if (getProviderId(provider) !== providerId) return failure('Provider 与登录凭据不匹配');
      return validate(getCredentials(credentials), httpClient);
    },
  }]),
);

module.exports = {
  VALIDATION_TIMEOUT_MS,
  createChat2ApiCredentialValidators,
};
