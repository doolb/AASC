const crypto = require('crypto');

const toIdSet = (value) => {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return new Set();
};

const normalizeEmail = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const normalizePhone = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\s\-()]/g, '').trim();
  return normalized || null;
};

const createRandomAccountId = (providerId) => `${providerId}-${crypto.randomBytes(6).toString('hex')}`;

const deriveAccountId = ({ providerId, email, phone, existingIds, incomingIds } = {}) => {
  const normalizedProviderId = typeof providerId === 'string' ? providerId.trim() : '';
  if (!normalizedProviderId) {
    throw new Error('Chat2API 新账号缺少 Provider');
  }
  const usedIds = new Set([...toIdSet(existingIds), ...toIdSet(incomingIds)]);
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const identity = normalizedEmail || normalizedPhone;
  const candidate = identity ? `${normalizedProviderId}:${identity}` : null;
  if (candidate && !usedIds.has(candidate)) return candidate;
  let randomId = createRandomAccountId(normalizedProviderId);
  while (usedIds.has(randomId)) randomId = createRandomAccountId(normalizedProviderId);
  return randomId;
};

const selectAccountId = (account = {}, context = {}) => {
  if (typeof account.accountId === 'string' && account.accountId.trim()) {
    return account.accountId.trim();
  }
  return deriveAccountId({
    providerId: account.providerId,
    email: account.email,
    phone: account.phone,
    existingIds: context.existingIds,
    incomingIds: context.incomingIds,
  });
};

module.exports = {
  normalizeEmail,
  normalizePhone,
  deriveAccountId,
  selectAccountId,
};
