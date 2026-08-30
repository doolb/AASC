const clone = (value) => JSON.parse(JSON.stringify(value));

const ensureIdentifier = (value, field) => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512) {
    throw new Error(`Responses 会话缺少有效的 ${field}`);
  }
  return value.trim();
};

const normalizeSession = (input = {}) => {
  const now = Date.now();
  const createdAt = Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : now;
  return {
    conversationId: ensureIdentifier(input.conversationId, 'conversationId'),
    providerId: input.providerId ? ensureIdentifier(input.providerId, 'providerId') : '',
    accountId: input.accountId ? ensureIdentifier(input.accountId, 'accountId') : '',
    actualModel: input.actualModel ? ensureIdentifier(input.actualModel, 'actualModel') : '',
    history: Array.isArray(input.history) ? clone(input.history) : [],
    nativeState: input.nativeState && typeof input.nativeState === 'object' ? clone(input.nativeState) : {},
    latestResponseId: input.latestResponseId ? ensureIdentifier(input.latestResponseId, 'latestResponseId') : '',
    responseIds: Array.isArray(input.responseIds)
      ? input.responseIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
      : (input.latestResponseId ? [input.latestResponseId] : []),
    createdAt,
    updatedAt: now,
  };
};

const createChat2ApiResponseSessionStore = ({ dataStore } = {}) => {
  if (!dataStore || typeof dataStore.readCollection !== 'function' || typeof dataStore.writeCollection !== 'function') {
    throw new Error('Responses 会话存储需要可读写的数据存储');
  }

  const locks = new Map();

  const list = async () => {
    const sessions = await dataStore.readCollection('responsesSessions', []);
    if (!Array.isArray(sessions)) {
      throw new Error('Responses 会话数据必须是数组');
    }
    return sessions.map(clone);
  };

  const get = async (conversationId) => {
    const normalizedId = ensureIdentifier(conversationId, 'conversationId');
    const sessions = await list();
    return sessions.find((session) => session.conversationId === normalizedId) || null;
  };

  const findByResponseId = async (responseId) => {
    const normalizedId = ensureIdentifier(responseId, 'responseId');
    const sessions = await list();
    return sessions.find((session) => session.latestResponseId === normalizedId || session.responseIds?.includes(normalizedId)) || null;
  };

  const save = async (input) => {
    const session = normalizeSession(input);
    const sessions = await list();
    const next = sessions.some((item) => item.conversationId === session.conversationId)
      ? sessions.map((item) => item.conversationId === session.conversationId ? session : item)
      : [...sessions, session];
    await dataStore.writeCollection('responsesSessions', next);
    return clone(session);
  };

  const create = async (input) => {
    const existing = await get(input && input.conversationId);
    if (existing) {
      return existing;
    }
    return save(input);
  };

  const withLock = async (conversationId, operation) => {
    const normalizedId = ensureIdentifier(conversationId, 'conversationId');
    if (typeof operation !== 'function') {
      throw new Error('Responses 会话锁需要异步操作');
    }
    const previous = locks.get(normalizedId) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    locks.set(normalizedId, current);
    try {
      return await current;
    } finally {
      if (locks.get(normalizedId) === current) {
        locks.delete(normalizedId);
      }
    }
  };

  return { list, get, findByResponseId, save, create, withLock };
};

module.exports = { createChat2ApiResponseSessionStore };
