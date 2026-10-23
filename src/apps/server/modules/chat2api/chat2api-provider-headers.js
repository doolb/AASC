'use strict';

/** 账号请求头共用组装，保留各Provider原有Cookie/Bearer规则。 */
const getCredentials = account => account && (account.credentials || account) || {};
const buildProviderHeaders = (provider, account, providerId) => {
  const credentials = getCredentials(account);
  const headers = { ...(provider.headers || {}) };
  const token = credentials.token || credentials.accessToken || credentials.refreshToken || credentials.refresh_token || credentials.ticket;
  if (token && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  const cookieParts = [];
  const cookie = credentials.cookie || credentials.cookies;
  if (typeof cookie === 'string' && cookie.trim()) {
    cookieParts.push(cookie.trim());
  } else if (cookie && typeof cookie === 'object') {
    for (const [key, value] of Object.entries(cookie)) cookieParts.push(`${key}=${value}`);
  }
  const cookieFields = {
    tongyi_sso_ticket: providerId === 'qwen' ? credentials.ticket || credentials.tongyi_sso_ticket : undefined,
    serviceToken: credentials.serviceToken || credentials.service_token,
    userId: credentials.userId || credentials.user_id,
    xiaomichatbot_ph: credentials.phToken || credentials.ph_token,
    sessionToken: credentials.sessionToken,
  };
  for (const [key, value] of Object.entries(cookieFields)) if (value) cookieParts.push(`${key === 'sessionToken' ? '__Secure-next-auth.session-token' : key}=${value}`);
  if (cookieParts.length > 0) headers.Cookie = cookieParts.join('; ');
  if (providerId === 'mimo' && cookieParts.length > 0) headers.Origin = headers.Origin || provider.apiEndpoint;
  return headers;
};

module.exports={buildProviderHeaders};
