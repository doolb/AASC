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
  const leaseCounts = new Map();
  let pendingLeases = 0;
  let writes = Promise.resolve();

  const lockError = (code) => Object.assign(new Error({
    response_session_busy: 'Responses 会话等待任务过多，请稍后重试',
    response_session_cancelled: 'Responses 会话等待已取消',
    response_session_timeout: 'Responses 会话等待超时',
  }[code]), { code, statusCode: { response_session_busy: 503, response_session_cancelled: 499, response_session_timeout: 504 }[code] });

  /**
   * 新租约与旧withLock共用同一任务链，允许豆包流在返回迭代器后继续占有会话。
   * 取消排队项只打开它自己的门；该链仍等待前任完成，不能删除锁后越过前任执行。
   */
  const acquireLock = async (conversationId, { signal, timeoutMs = 120000 } = {}) => {
    const normalizedId = ensureIdentifier(conversationId, 'conversationId');
    if (signal?.aborted) throw lockError('response_session_cancelled');
    if (pendingLeases >= 256 || (leaseCounts.get(normalizedId) || 0) >= 16) throw lockError('response_session_busy');
    const previous = (locks.get(normalizedId) || Promise.resolve()).catch(() => {});
    let releaseGate;
    const gate = new Promise(resolve => { releaseGate = resolve; });
    const current = previous.then(() => gate);
    locks.set(normalizedId, current);
    pendingLeases++;
    leaseCounts.set(normalizedId, (leaseCounts.get(normalizedId) || 0) + 1);
    // 被取消的排队项也占用链容量，直至前任真正完成，防止取消洪泛建立无界Promise链。
    current.then(() => {
      pendingLeases--;
      const count = (leaseCounts.get(normalizedId) || 1) - 1;
      if (count) leaseCounts.set(normalizedId, count); else leaseCounts.delete(normalizedId);
      if (locks.get(normalizedId) === current) locks.delete(normalizedId);
    });
    let released = false;
    const release = () => { if (!released) { released = true; releaseGate(); } };
    let rejectWait;
    const stopped = new Promise((_,reject) => { rejectWait = reject; });
    const onAbort = () => rejectWait(lockError('response_session_cancelled'));
    const duration = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs,120000) : 120000;
    const timer = setTimeout(() => rejectWait(lockError('response_session_timeout')), duration);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await Promise.race([previous,stopped]);
      if (signal?.aborted) throw lockError('response_session_cancelled');
      return { release };
    } catch (error) {
      release(); throw error;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    }
  };

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
    // 不同会话生成可并行，但整个JSON集合的读改写须串行，否则后写会覆盖先写的新会话。
    const current = writes.catch(() => {}).then(async () => {
      const sessions = await list();
      const next = sessions.some((item) => item.conversationId === session.conversationId)
        ? sessions.map((item) => item.conversationId === session.conversationId ? session : item)
        : [...sessions, session];
      await dataStore.writeCollection('responsesSessions', next);
      return clone(session);
    });
    writes = current;
    return current;
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

  return { list, get, findByResponseId, save, create, withLock, acquireLock };
};

module.exports = { createChat2ApiResponseSessionStore };
