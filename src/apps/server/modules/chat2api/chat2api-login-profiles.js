const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    freezeDeep(child);
  }
  return Object.freeze(value);
};

/**
 * Android 登录 WebView 只允许使用这里声明的来源和字段。
 * 配置中故意不提供可执行脚本，避免 Provider 页面或远端配置扩大凭据采集范围。
 */
const ANDROID_LOGIN_PROFILES = freezeDeep({
  deepseek: {
    loginUrl: 'https://chat.deepseek.com',
    allowedOrigins: ['https://chat.deepseek.com'],
    authorization: null,
    localStorage: [{ key: 'userToken', field: 'token' }],
    cookies: [],
    requiredFields: ['token'],
  },
  glm: {
    loginUrl: 'https://chatglm.cn',
    allowedOrigins: ['https://chatglm.cn'],
    authorization: null,
    localStorage: [],
    cookies: [{ name: 'chatglm_refresh_token', field: 'refresh_token' }],
    requiredFields: ['refresh_token'],
  },
  kimi: {
    loginUrl: 'https://www.kimi.com',
    allowedOrigins: ['https://www.kimi.com'],
    authorization: { scheme: 'Bearer', field: 'token' },
    localStorage: [],
    cookies: [],
    requiredFields: ['token'],
  },
  minimax: {
    loginUrl: 'https://agent.minimaxi.com',
    allowedOrigins: ['https://agent.minimaxi.com'],
    authorization: null,
    localStorage: [{ key: '_token', field: 'token' }, { key: 'user_detail_agent', field: 'realUserID' }],
    cookies: [],
    requiredFields: ['token'],
  },
  mimo: {
    loginUrl: 'https://aistudio.xiaomimimo.com',
    allowedOrigins: ['https://aistudio.xiaomimimo.com'],
    authorization: null,
    localStorage: [],
    cookies: [
      { name: 'serviceToken', field: 'service_token' },
      { name: 'userId', field: 'user_id' },
      { name: 'xiaomichatbot_ph', field: 'ph_token' },
    ],
    requiredFields: ['service_token', 'user_id', 'ph_token'],
  },
  perplexity: {
    loginUrl: 'https://www.perplexity.ai',
    allowedOrigins: ['https://www.perplexity.ai'],
    authorization: null,
    localStorage: [],
    cookies: [
      { name: '__Secure-next-auth.session-token', field: 'sessionToken' },
      { name: 'next-auth.session-token', field: 'sessionToken' },
    ],
    requiredFields: ['sessionToken'],
  },
  qwen: {
    loginUrl: 'https://www.qianwen.com',
    allowedOrigins: ['https://www.qianwen.com', 'https://chat2.qianwen.com', 'https://chat2-api.qianwen.com'],
    authorization: null,
    localStorage: [],
    cookies: [{ name: 'tongyi_sso_ticket', field: 'ticket' }],
    requiredFields: ['ticket'],
  },
  'qwen-ai': {
    loginUrl: 'https://chat.qwen.ai',
    allowedOrigins: ['https://chat.qwen.ai'],
    authorization: null,
    localStorage: [{ key: 'token', field: 'token' }],
    cookies: [{ name: 'token', field: 'token' }],
    requiredFields: ['token'],
  },
  zai: {
    loginUrl: 'https://chat.z.ai',
    allowedOrigins: ['https://chat.z.ai'],
    authorization: null,
    localStorage: [{ key: 'token', field: 'token' }],
    cookies: [{ name: 'token', field: 'token' }],
    requiredFields: ['token'],
  },
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const getAndroidLoginProfile = (providerId) => {
  const profile = ANDROID_LOGIN_PROFILES[providerId];
  return profile ? clone(profile) : null;
};

module.exports = {
  ANDROID_LOGIN_PROFILES,
  getAndroidLoginProfile,
};
