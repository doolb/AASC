const crypto = require('crypto');

// 这些字段可能直接携带第三方登录凭据，任何对外返回都必须剔除。
const SECRET_FIELDS = new Set([
  'token',
  'accessToken',
  'refreshToken',
  'cookie',
  'apiKey',
  'password',
  'clientSecret',
]);

const cloneValue = (value) => {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
};

const sanitizeSecrets = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSecrets(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SECRET_FIELDS.has(key)) {
      result[key] = sanitizeSecrets(item);
    }
  }
  return result;
};

const hasConfiguredSecret = (value) => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Object.entries(value).some(([key, item]) => SECRET_FIELDS.has(key) && typeof item === 'string' && item.length > 0)) {
    return true;
  }
  return Object.values(value).some((item) => item && typeof item === 'object' && hasConfiguredSecret(item));
};

const maskSecret = (value, visibleLength = 4) => {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }
  const prefixLength = Math.min(visibleLength, Math.max(1, value.length - 4));
  return `${value.slice(0, prefixLength)}${'*'.repeat(4)}`;
};

const createApiKeyValue = () => `aasc_chat2api_${crypto.randomBytes(32).toString('base64url')}`;

const hashSecret = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

const equalSecretHash = (value, expectedHash) => {
  if (typeof value !== 'string' || typeof expectedHash !== 'string') {
    return false;
  }
  const actual = Buffer.from(hashSecret(value), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

module.exports = {
  cloneValue,
  sanitizeSecrets,
  hasConfiguredSecret,
  maskSecret,
  createApiKeyValue,
  hashSecret,
  equalSecretHash,
};
