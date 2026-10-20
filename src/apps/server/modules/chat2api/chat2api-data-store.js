const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  cloneValue,
  sanitizeSecrets,
  hasConfiguredSecret,
  maskSecret,
  createApiKeyValue,
  hashSecret,
  equalSecretHash,
} = require('./chat2api-secret');
const { selectAccountId } = require('./chat2api-account-identity');
const { normalizeDoubaoCredentials } = require('./chat2api-doubao-chat-adapter');
const { normalizeDoubaoCookieSnapshot, canonicalDoubaoCookieFromSnapshot } = require('./chat2api-doubao-cookie-snapshot');
const {canonicalProviderId}=require('./chat2api-model-capabilities');
const {validateMappingExtension}=require('./chat2api-system-controls');
const {normalizeApiAccount}=require('./chat2api-api-account');
const { ERROR_CODES } = require('./chat2api-doubao-account-verifier');
const { effectiveModelMappings } = require('./chat2api-default-model-mappings');

// 同一进程内多个runtime可能共用账号目录，锁以目录为键；空闲后释放，不积累全局状态。
const accountWriteQueues = new Map();
const accountCredentialVersion = account => hashSecret(JSON.stringify({
  providerId: account.providerId,
  revision: account.credentialRevision || '',
  credentials: normalizeDoubaoCredentials(account.credentials),
}));
const VERIFICATION_FIELDS = ['credentialVerification', 'credentialVerificationStatus', 'credentialVerificationCheckedAt',
  'credentialVerificationError', 'browserChatVerifiedAt', 'nodeChatVerifiedAt'];
const resetDoubaoVerification = account => {
  if (account.providerId !== 'doubaochat') return account;
  const accountInfo = { ...(account.accountInfo || {}) };
  VERIFICATION_FIELDS.forEach(key => delete accountInfo[key]);
  return { ...account, credentialRevision: crypto.randomUUID(), accountInfo: { ...accountInfo, credentialVerification: 'format-only' } };
};

const DEFAULT_ROOT_DIR = path.join(os.homedir(), '.config', 'aasc-user', 'chat2api');
const DEFAULT_LEGACY_DATA_PATH = path.join(os.homedir(), '.chat2api', 'data.json');
const COLLECTION_FILES = Object.freeze({
  config: 'config.json',
  providers: 'providers.json',
  accounts: 'accounts.json',
  apiKeys: 'api-keys.json',
  modelMappings: 'model-mappings.json',
  responsesSessions: 'responses-sessions.json',
  legacyAccountReuse: 'legacy-account-reuse.json',
});
const EXPORT_FORMAT = 'aasc-chat2api-config';
const ACCOUNT_EXPORT_FORMAT = 'aasc-chat2api-accounts';
const IMPORT_COLLECTIONS = Object.freeze(['providers', 'accounts', 'modelMappings']);
const MAX_IMPORT_ITEMS = 1000;
const OAUTH_SESSION_TTL_MS = 5 * 60 * 1000;
const ACCOUNT_INFO_FIELDS = new Set(['id', 'userId', 'realUserID', 'name', 'nickname', 'username', 'email', 'phone', ...VERIFICATION_FIELDS, 'endpoint','resourceId']);
const BUILTIN_PROVIDER_IDS = new Set(['deepseek', 'glm', 'kimi', 'minimax', 'mimo', 'perplexity', 'qwen', 'qwen-ai', 'zai', 'doubaochat','qwen-api','doubaapi']);

const assertCollectionName = (name) => {
  if (!Object.prototype.hasOwnProperty.call(COLLECTION_FILES, name)) {
    throw new Error(`不支持的 Chat2API 数据集合: ${name}`);
  }
};

const ensureArray = (value, name) => {
  if (!Array.isArray(value)) {
    throw new Error(`Chat2API 导入字段 ${name} 必须是数组`);
  }
  if (value.length > MAX_IMPORT_ITEMS) {
    throw new Error(`Chat2API 导入字段 ${name} 超过数量限制`);
  }
  return value;
};

const ensureId = (value, field, context) => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new Error(`${context}缺少有效的 ${field}`);
  }
  return value.trim();
};

const mergeByKey = (current, incoming, keySelector) => {
  const merged = new Map(current.map((item) => [keySelector(item), item]));
  for (const item of incoming) {
    merged.set(keySelector(item), item);
  }
  return [...merged.values()];
};

const createChat2ApiDataStore = (options = {}) => {
  const rootDir = path.resolve(options.rootDir || DEFAULT_ROOT_DIR);
  const legacyDataPath = path.resolve(options.legacyDataPath || DEFAULT_LEGACY_DATA_PATH);
  const filePath = (name) => path.join(rootDir, COLLECTION_FILES[name]);
  const oauthSessionDir = path.join(rootDir, 'oauth-sessions');
  const accountImportPreviews = new Map();
  const ACCOUNT_IMPORT_PREVIEW_TTL_MS = 5 * 60 * 1000;

  const withAccountLock = async operation => {
    const previous = accountWriteQueues.get(rootDir) || Promise.resolve();
    const pending = previous.catch(() => {}).then(operation);
    accountWriteQueues.set(rootDir, pending);
    try { return await pending; }
    finally { if (accountWriteQueues.get(rootDir) === pending) accountWriteQueues.delete(rootDir); }
  };

  const ensurePrivateDirectory = async () => {
    await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
    // 目录可能是历史版本创建的，显式修正权限，避免凭据目录被组用户读取。
    await fs.chmod(rootDir, 0o700);
  };

  const ensureOAuthSessionDirectory = async () => {
    await ensurePrivateDirectory();
    await fs.mkdir(oauthSessionDir, { recursive: true, mode: 0o700 });
    await fs.chmod(oauthSessionDir, 0o700);
  };

  const oauthSessionPath = (state) => {
    if (typeof state !== 'string' || !/^[a-f0-9]{32,128}$/.test(state)) {
      return null;
    }
    return path.join(oauthSessionDir, `${state}.json`);
  };

  const writePrivateJson = async (target, value) => {
    const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporary, target);
      await fs.chmod(target, 0o600);
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
  };

  const readCollection = async (name, fallback = []) => {
    assertCollectionName(name);
    await ensurePrivateDirectory();
    try {
      const content = await fs.readFile(filePath(name), 'utf8');
      await fs.chmod(filePath(name), 0o600);
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return cloneValue(fallback);
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Chat2API 数据文件 ${COLLECTION_FILES[name]} 格式错误`);
      }
      throw error;
    }
  };

  const writeCollectionUnlocked = async (name, value) => {
    assertCollectionName(name);
    await ensurePrivateDirectory();
    const target = filePath(name);
    const temporary = path.join(rootDir, `.${COLLECTION_FILES[name]}.tmp-${process.pid}-${crypto.randomUUID()}`);
    const content = `${JSON.stringify(value, null, 2)}\n`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporary, target);
      await fs.chmod(target, 0o600);
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
  };

  const writeCollection = (name, value) => name === 'accounts'
    ? withAccountLock(() => writeCollectionUnlocked(name, value)) : writeCollectionUnlocked(name, value);

  const validateAccount = (account) => {
    if (!account || typeof account !== 'object') {
      throw new Error('Chat2API 账号必须是对象');
    }
    const accountId = ensureId(account.accountId, 'accountId', 'Chat2API 账号');
    const providerId = canonicalProviderId(ensureId(account.providerId, 'providerId', 'Chat2API 账号'));
    const normalized = { ...cloneValue(account), accountId, providerId };
    if(['qwen-api','doubaapi'].includes(providerId)) {
      Object.assign(normalized,normalizeApiAccount(account.credentials,selectAccountInfo(account.accountInfo)));
    }
    if (providerId === 'doubaochat') {
      // 账号导入只表示用户恢复凭据，不表示已验证登录；秘密不得散落在顶层或其他 secret 字段。
      const accountFields = new Set(['accountId', 'providerId', 'label', 'email', 'phone', 'authMethod', 'enabled', 'status', 'createdAt', 'updatedAt', 'todayUsed', 'todayLimit', 'dailyLimit', 'lastUsed', 'credentials', 'accountInfo', 'credentialRevision']);
      if (Object.keys(account).some((key) => !accountFields.has(key))) {
        throw Object.assign(new Error('豆包账号秘密只允许 credentials.cookie、credentials.nodeProfile、credentials.cookieSnapshot 和 credentials.requestProfile'), { statusCode: 422, code: 'doubao_invalid_credentials' });
      }
      normalized.credentials = normalizeDoubaoCredentials(account.credentials);
      normalized.accountInfo = selectAccountInfo(account.accountInfo);
    }
    return normalized;
  };

  const selectAccountInfo = (accountInfo) => {
    if (!accountInfo || typeof accountInfo !== 'object' || Array.isArray(accountInfo)) return {};
    const selected = Object.fromEntries(Object.entries(accountInfo).filter(([key, value]) => (
      ACCOUNT_INFO_FIELDS.has(key)
      && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    )));
    if (!['format-only', 'conversation-list'].includes(selected.credentialVerification)) delete selected.credentialVerification;
    if (!['verified', 'failed'].includes(selected.credentialVerificationStatus)) delete selected.credentialVerificationStatus;
    if (selected.credentialVerificationError !== '' && !ERROR_CODES.has(selected.credentialVerificationError)) delete selected.credentialVerificationError;
    if (typeof selected.credentialVerificationCheckedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(selected.credentialVerificationCheckedAt)) delete selected.credentialVerificationCheckedAt;
    for (const field of ['browserChatVerifiedAt', 'nodeChatVerifiedAt']) {
      if (typeof selected[field] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(selected[field])) delete selected[field];
    }
    return selected;
  };

  const selectAccountCredentialFields = (account) => {
    const result = {
      accountId: account.accountId,
      providerId: account.providerId,
    };
    for (const field of ['label', 'email', 'phone', 'cookie', 'authMethod', 'enabled']) {
      if (account[field] !== undefined) result[field] = cloneValue(account[field]);
    }
    if (account.accountInfo !== undefined) result.accountInfo = selectAccountInfo(account.accountInfo);
    if (account.credentials !== undefined) {
      if (!account.credentials || typeof account.credentials !== 'object' || Array.isArray(account.credentials)) {
        throw new Error(`Chat2API 账号 ${account.accountId} 的 credentials 必须是对象`);
      }
      result.credentials = cloneValue(account.credentials);
    }
    return result;
  };

  const sortKeysDeep = (value) => {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
  };

  const createImportConfirmation = (accounts, items) => hashSecret(JSON.stringify(sortKeysDeep({ accounts, items })));
  const createAccountImportPayloadHash = (data) => hashSecret(JSON.stringify(sortKeysDeep(data)));

  const publicAccount = (account) => {
    const { credentialRevision, ...publicFields } = account;
    return { ...sanitizeSecrets(publicFields), secretConfigured: hasConfiguredSecret(account) };
  };

  const saveAccount = account => withAccountLock(async () => {
    const normalized = validateAccount(account);
    if (normalized.providerId === 'doubaochat') {
      normalized.credentialRevision = crypto.randomUUID();
      normalized.accountInfo.credentialVerification ||= 'format-only';
    }
    const current = await readCollection('accounts', []);
    const next = mergeByKey(current, [normalized], (item) => item.accountId);
    await writeCollectionUnlocked('accounts', next);
    return publicAccount(normalized);
  });

  /** 外部网页只允许以会话创建时的凭据版本原子刷新原豆包账号，避免覆盖同期重新登录。 */
  const refreshDoubaoCookieSnapshot = (accountId, expectedRevision, inputSnapshot, inputProfile) => withAccountLock(async () => {
    const snapshot = normalizeDoubaoCookieSnapshot(inputSnapshot);
    const accounts = await readCollection('accounts', []);
    const index = accounts.findIndex(item => item.accountId === accountId && item.providerId === 'doubaochat');
    const current = accounts[index];
    if (!current || current.credentialRevision !== expectedRevision) {
      throw Object.assign(new Error('豆包账号已变化，请重新打开外部网页'), { statusCode: 409, code: 'account_credential_changed' });
    }
    const cookie = canonicalDoubaoCookieFromSnapshot(snapshot);
    const credentials = normalizeDoubaoCredentials({ cookie,
      ...(current.credentials?.nodeProfile ? { nodeProfile: current.credentials.nodeProfile } : {}),
      cookieSnapshot: snapshot,
      ...(inputProfile ? { requestProfile: inputProfile } : {}) });
    const updated = resetDoubaoVerification({ ...current, credentials, updatedAt: Date.now() });
    if (credentials.requestProfile?.browserVerifiedAt) updated.accountInfo.browserChatVerifiedAt = credentials.requestProfile.browserVerifiedAt;
    accounts[index] = updated;
    await writeCollectionUnlocked('accounts', accounts);
    return { refreshed: true };
  });

  const listAccounts = async () => {
    await restoreLegacyAccounts();
    const accounts = await readCollection('accounts', []);
    ensureArray(accounts, 'accounts');
    return accounts.map((account) => publicAccount(account));
  };

  /** 内部调度只需账号ID；一次读取集合，避免为判断传输而逐个读秘密或公开设备资料。 */
  const listDoubaoNodeAccountIds = async () => {
    await restoreLegacyAccounts();
    const accounts = await readCollection('accounts', []);
    ensureArray(accounts, 'accounts');
    return accounts.filter(account => account.providerId === 'doubaochat' && account.enabled !== false
      && (!account.status || account.status === 'active') && account.credentials?.nodeProfile)
      .map(account => account.accountId);
  };

  const getAccount = async (accountId) => {
    const accounts = await readCollection('accounts', []);
    ensureArray(accounts, 'accounts');
    return accounts.find((account) => account.accountId === accountId) || null;
  };

  const updateAccount = (accountId, patch = {}) => withAccountLock(async () => {
    const current = await getAccount(accountId);
    if (!current) {
      return null;
    }
    let next = validateAccount({ ...current, ...patch, accountId: current.accountId, providerId: current.providerId, credentials: patch.credentials || current.credentials });
    if (next.providerId === 'doubaochat') {
      // 普通编辑不能伪造远端检查结果；专用比较写入接口才允许推进验证状态。
      next.credentialRevision = current.credentialRevision;
      next.accountInfo = { ...next.accountInfo };
      VERIFICATION_FIELDS.forEach(key => { delete next.accountInfo[key]; if (current.accountInfo?.[key] !== undefined) next.accountInfo[key] = current.accountInfo[key]; });
      if (accountCredentialVersion(next) !== accountCredentialVersion(current)) next = resetDoubaoVerification(next);
    }
    const accounts = await readCollection('accounts', []);
    await writeCollectionUnlocked('accounts', accounts.map((account) => account.accountId === accountId ? next : account));
    return publicAccount(next);
  });

  const updateAccountVerification = (accountId, expectedVersion, metadata) => withAccountLock(async () => {
    const accounts = await readCollection('accounts', []);
    const current = accounts.find(account => account.accountId === accountId);
    if (!current || current.providerId !== 'doubaochat' || accountCredentialVersion(current) !== expectedVersion) return null;
    const next = validateAccount({ ...current, accountInfo: { ...current.accountInfo, ...selectAccountInfo(metadata) } });
    await writeCollectionUnlocked('accounts', accounts.map(account => account.accountId === accountId ? next : account));
    return publicAccount(next);
  });

  /** 仅在本服务的实际 Node 聊天完整结束后记录能力；账号在请求期间变化则不写入旧结果。 */
  const markDoubaoNodeChatVerified = (accountId, expectedVersion) => withAccountLock(async () => {
    const accounts = await readCollection('accounts', []);
    const index = accounts.findIndex(account => account.accountId === accountId && account.providerId === 'doubaochat');
    if (index < 0 || accountCredentialVersion(accounts[index]) !== expectedVersion) return false;
    accounts[index] = { ...accounts[index], accountInfo: { ...accounts[index].accountInfo,
      nodeChatVerifiedAt: new Date().toISOString() } };
    await writeCollectionUnlocked('accounts', accounts);
    return true;
  });

  /** 浏览器任务的完成结果单独标记，不能冒充 Node HTTP 直连成功。 */
  const markDoubaoBrowserChatVerified = (accountId, expectedVersion) => withAccountLock(async () => {
    const accounts = await readCollection('accounts', []);
    const index = accounts.findIndex(account => account.accountId === accountId && account.providerId === 'doubaochat');
    if (index < 0 || accountCredentialVersion(accounts[index]) !== expectedVersion) return false;
    accounts[index] = { ...accounts[index], accountInfo: { ...accounts[index].accountInfo,
      browserChatVerifiedAt: new Date().toISOString() } };
    await writeCollectionUnlocked('accounts', accounts);
    return true;
  });

  const deleteAccount = async accountId => {
    await restoreLegacyAccounts();
    return withAccountLock(async () => {
    const accounts = await readCollection('accounts', []);
    const next = accounts.filter((account) => account.accountId !== accountId);
    if (next.length === accounts.length) {
      return false;
    }
    // 删除是明确的用户决定，即使旧资料后来出现，也不能自动复活被删除账号。
    await writeCollectionUnlocked('legacyAccountReuse', { schemaVersion: 1, completed: true });
    await writeCollectionUnlocked('accounts', next);
    return true;
    });
  };

  const listModelMappings = async () => {
    const mappings = await readCollection('modelMappings', []);
    ensureArray(mappings, 'modelMappings');
    return cloneValue(mappings);
  };

  const listEffectiveModelMappings = async () => effectiveModelMappings(await listModelMappings());

  const saveModelMapping = async (mapping) => {
    validateMappingExtension(mapping || {});
    if (!mapping || typeof mapping.model !== 'string' || mapping.model.trim().length === 0 || typeof mapping.actualModel !== 'string' || mapping.actualModel.trim().length === 0) {
      throw new Error('Chat2API 模型映射必须包含 model 和 actualModel');
    }
    const { builtinDefault, ...fields } = cloneValue(mapping);
    const normalized = { ...fields, model: mapping.model.trim(), actualModel: mapping.actualModel.trim() };
    const mappings = await listModelMappings();
    await writeCollection('modelMappings', mergeByKey(mappings, [normalized], (item) => item.model.toLowerCase()));
    return normalized;
  };

  const deleteModelMapping = async (model) => {
    const mappings = await listModelMappings();
    const next = mappings.filter((mapping) => mapping.model.toLowerCase() !== model.toLowerCase());
    if (next.length === mappings.length) return false;
    await writeCollection('modelMappings', next);
    return true;
  };

  const createOAuthSession = async ({ providerId, loginUrl, ttlMs = OAUTH_SESSION_TTL_MS } = {}) => {
    if (typeof providerId !== 'string' || providerId.trim().length === 0 || typeof loginUrl !== 'string' || loginUrl.length === 0) {
      throw new Error('Chat2API OAuth 会话参数无效');
    }
    await ensureOAuthSessionDirectory();
    const state = crypto.randomBytes(24).toString('hex');
    const session = {
      state,
      providerId: providerId.trim(),
      loginUrl,
      createdAt: Date.now(),
      expiresAt: Date.now() + Math.max(1_000, Number(ttlMs) || OAUTH_SESSION_TTL_MS),
    };
    await writePrivateJson(oauthSessionPath(state), session);
    return { ...session };
  };

  const consumeOAuthSession = async (state, providerId) => {
    const target = oauthSessionPath(state);
    if (!target) {
      return null;
    }
    try {
      const session = JSON.parse(await fs.readFile(target, 'utf8'));
      if (providerId && session.providerId !== providerId) {
        return null;
      }
      await fs.unlink(target).catch(() => {});
      if (session.expiresAt <= Date.now()) {
        return null;
      }
      return session;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) {
        return null;
      }
      throw error;
    }
  };

  const getOAuthSession = async (state, providerId) => {
    const target = oauthSessionPath(state);
    if (!target) {
      return null;
    }
    try {
      const session = JSON.parse(await fs.readFile(target, 'utf8'));
      if (providerId && session.providerId !== providerId) {
        return null;
      }
      if (session.expiresAt <= Date.now()) {
        return null;
      }
      return session;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) {
        return null;
      }
      throw error;
    }
  };

  const cancelOAuthSession = async (state) => {
    const target = oauthSessionPath(state);
    if (target) {
      await fs.unlink(target).catch(() => {});
    }
  };

  const clearOAuthSessions = async () => {
    await ensureOAuthSessionDirectory();
    const names = await fs.readdir(oauthSessionDir);
    await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => fs.unlink(path.join(oauthSessionDir, name)).catch(() => {})));
  };

  const createApiKey = async (input = {}) => {
    const value = createApiKeyValue();
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      label: typeof input.label === 'string' ? input.label.trim() : '',
      hash: hashSecret(value),
      maskedValue: maskSecret(value, 20),
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now,
    };
    const current = await readCollection('apiKeys', []);
    await writeCollection('apiKeys', [...current, record]);
    const { hash, ...publicRecord } = record;
    return { ...publicRecord, value };
  };

  const listApiKeys = async () => {
    const keys = await readCollection('apiKeys', []);
    ensureArray(keys, 'apiKeys');
    return keys.map(({ hash, ...publicKey }) => publicKey);
  };

  const validateApiKey = async (value) => {
    const keys = await readCollection('apiKeys', []);
    ensureArray(keys, 'apiKeys');
    const matched = keys.find((key) => key.enabled !== false && equalSecretHash(value, key.hash));
    if (!matched) {
      return null;
    }
    const { hash, ...publicKey } = matched;
    return publicKey;
  };

  const updateApiKey = async (id, patch = {}) => {
    const keys = await readCollection('apiKeys', []);
    const current = keys.find((key) => key.id === id);
    if (!current) return null;
    const next = { ...current, ...patch, id: current.id, hash: current.hash, maskedValue: current.maskedValue, updatedAt: new Date().toISOString() };
    await writeCollection('apiKeys', keys.map((key) => key.id === id ? next : key));
    const { hash, ...publicKey } = next;
    return publicKey;
  };

  const disableApiKey = async (id) => updateApiKey(id, { enabled: false });

  const deleteApiKey = async (id) => {
    const keys = await readCollection('apiKeys', []);
    const next = keys.filter((key) => key.id !== id);
    if (next.length === keys.length) return false;
    await writeCollection('apiKeys', next);
    return true;
  };

  const normalizeImportConfig = (config) => {
    if (config === undefined || config === null) {
      return {};
    }
    if (typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Chat2API 导入字段 config 必须是对象');
    }
    return cloneValue(config);
  };

  const exportConfiguration = async () => {
    const [config, providers, accounts, modelMappings] = await Promise.all([
      readCollection('config', {}),
      readCollection('providers', []),
      readCollection('accounts', []),
      readCollection('modelMappings', []),
    ]);
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Chat2API 配置数据必须是对象');
    }
    ensureArray(providers, 'providers');
    ensureArray(accounts, 'accounts');
    ensureArray(modelMappings, 'modelMappings');
    return {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      config: cloneValue(config),
      providers: cloneValue(providers),
      accounts: accounts.map(({ credentialRevision, ...account }) => cloneValue(account)),
      modelMappings: cloneValue(modelMappings),
    };
  };

  const normalizeAccountCredentialBundle = async (data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Chat2API 账号凭证包必须是对象');
    }
    if (data.format !== ACCOUNT_EXPORT_FORMAT || data.version !== 1) {
      throw new Error('Chat2API 账号凭证包格式或版本不受支持');
    }
    const rawAccounts = ensureArray(data.accounts || [], 'accounts');
    const currentAccounts = await readCollection('accounts', []);
    ensureArray(currentAccounts, 'accounts');
    const existingIds = new Set(currentAccounts.map((account) => account.accountId));
    const incomingIds = new Set();
    const accounts = rawAccounts.map((rawAccount) => {
      if (!rawAccount || typeof rawAccount !== 'object' || Array.isArray(rawAccount)) {
        throw new Error('Chat2API 账号凭证包中的账号必须是对象');
      }
      const account = selectAccountCredentialFields(rawAccount);
      if (!account.providerId || typeof account.providerId !== 'string') {
        throw new Error('Chat2API 账号凭证包中的账号缺少 providerId');
      }
      account.providerId = account.providerId.trim();
      account.accountId = selectAccountId(account, { existingIds, incomingIds });
      if (incomingIds.has(account.accountId)) {
        throw new Error(`Chat2API 账号凭证包包含重复 accountId: ${account.accountId}`);
      }
      incomingIds.add(account.accountId);
      return canonicalProviderId(account.providerId) === 'doubaochat' ? resetDoubaoVerification(validateAccount(account)) : account;
    });
    return accounts;
  };

  const exportAccountCredentials = async () => {
    const accounts = await readCollection('accounts', []);
    ensureArray(accounts, 'accounts');
    return {
      format: ACCOUNT_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: accounts.map(selectAccountCredentialFields),
    };
  };

  const previewAccountImport = async (data) => {
    const accounts = await normalizeAccountCredentialBundle(data);
    const [currentAccounts, providers] = await Promise.all([
      readCollection('accounts', []),
      readCollection('providers', []),
    ]);
    const existingIds = new Set(currentAccounts.map((account) => account.accountId));
    const providerMap = new Map(providers.map((provider) => [provider.providerId || provider.id, provider]));
    const items = accounts.map((account) => {
      const storedProvider = providerMap.get(account.providerId);
      const providerAvailable = (BUILTIN_PROVIDER_IDS.has(account.providerId) || Boolean(storedProvider))
        && storedProvider?.enabled !== false;
      const action = existingIds.has(account.accountId) ? 'update' : 'new';
      if (!providerAvailable) {
        return {
          accountId: account.accountId,
          providerId: account.providerId,
          label: account.label || '',
          email: account.email || '',
          phone: account.phone || '',
          action: 'invalid',
          error: 'provider_unavailable',
          credentialFields: Object.keys(account.credentials || {}),
          secretConfigured: hasConfiguredSecret(account),
        };
      }
      return {
        accountId: account.accountId,
        providerId: account.providerId,
        label: account.label || '',
        email: account.email || '',
        phone: account.phone || '',
        action,
        credentialFields: Object.keys(account.credentials || {}),
        secretConfigured: hasConfiguredSecret(account),
      };
    });
    const counts = {
      new: items.filter((item) => item.action === 'new').length,
      update: items.filter((item) => item.action === 'update').length,
      invalid: items.filter((item) => item.action === 'invalid').length,
    };
    const confirmation = createImportConfirmation(accounts, items);
    accountImportPreviews.set(confirmation, {
      payloadHash: createAccountImportPayloadHash(data),
      accounts,
      preview: { version: 1, items, counts, confirmation },
      expiresAt: Date.now() + ACCOUNT_IMPORT_PREVIEW_TTL_MS,
    });
    return {
      version: 1,
      items,
      counts,
      confirmation,
    };
  };

  const mergeAccountImport = (data, confirmation, confirmed) => withAccountLock(async () => {
    if (confirmed !== true) {
      throw new Error('Chat2API 账号凭证导入必须先预览并明确确认');
    }
    const pending = typeof confirmation === 'string' ? accountImportPreviews.get(confirmation) : null;
    if (!pending || pending.expiresAt <= Date.now() || pending.payloadHash !== createAccountImportPayloadHash(data)) {
      const error = new Error('Chat2API 账号凭证导入确认摘要已失效，请重新预览');
      error.statusCode = 409;
      error.code = 'import_confirmation_mismatch';
      throw error;
    }
    accountImportPreviews.delete(confirmation);
    const accounts = pending.accounts;
    const preview = pending.preview;
    if (preview.counts.invalid > 0) {
      const error = new Error('Chat2API 账号凭证导入包含不可用 Provider');
      error.statusCode = 422;
      error.code = 'import_provider_unavailable';
      throw error;
    }
    const currentAccounts = await readCollection('accounts', []);
    const currentById = new Map(currentAccounts.map((account) => [account.accountId, account]));
    const merged = accounts.map((account) => {
      const current = currentById.get(account.accountId);
      const next = current ? { ...current, ...account } : account;
      if (current && account.accountInfo) next.accountInfo = { ...(current.accountInfo || {}), ...account.accountInfo };
      return resetDoubaoVerification(validateAccount(next));
    });
    const nextAccounts = mergeByKey(currentAccounts, merged, (account) => account.accountId);
    await writeCollectionUnlocked('accounts', nextAccounts);
    return {
      version: 1,
      counts: preview.counts,
      accounts: merged.map(publicAccount),
    };
  });

  const normalizeImport = (data) => {
    if (!data || typeof data !== 'object' || data.version !== 1) {
      throw new Error('Chat2API 导入文件版本不受支持');
    }
    if (data.format !== undefined && data.format !== EXPORT_FORMAT) {
      throw new Error('Chat2API 导入文件格式不受支持');
    }
    const providers = ensureArray(data.providers || [], 'providers');
    const accounts = ensureArray(data.accounts || [], 'accounts').map(account => resetDoubaoVerification(validateAccount(account)));
    const modelMappings = ensureArray(data.modelMappings || [], 'modelMappings');
    providers.forEach((provider) => ensureId(provider.providerId, 'providerId', 'Chat2API Provider'));
    modelMappings.forEach((mapping) => {ensureId(mapping.model, 'model', 'Chat2API 模型映射');validateMappingExtension(mapping);});
    return {
      config: normalizeImportConfig(data.config),
      providers: cloneValue(providers),
      accounts,
      modelMappings: cloneValue(modelMappings),
    };
  };

  const importPreview = (data) => {
    const normalized = normalizeImport(data);
    return {
      version: 1,
      config: cloneValue(normalized.config),
      counts: Object.fromEntries(IMPORT_COLLECTIONS.map((name) => [name, normalized[name].length])),
      providers: normalized.providers.map((provider) => sanitizeSecrets(provider)),
      accounts: normalized.accounts.map((account) => publicAccount(account)),
      modelMappings: normalized.modelMappings.map((mapping) => sanitizeSecrets(mapping)),
    };
  };

  const previewImport = async (data) => importPreview(data);

  const mergeImport = (data, confirmed) => withAccountLock(async () => {
    if (confirmed !== true) {
      throw new Error('Chat2API 导入必须先预览并明确确认');
    }
    const normalized = normalizeImport(data);
    const [current, currentConfig] = await Promise.all([
      Promise.all(IMPORT_COLLECTIONS.map((name) => readCollection(name, []))),
      readCollection('config', {}),
    ]);
    const currentByName = Object.fromEntries(IMPORT_COLLECTIONS.map((name, index) => [name, current[index]]));
    const next = {
      providers: mergeByKey(currentByName.providers, normalized.providers, (item) => item.providerId),
      accounts: mergeByKey(currentByName.accounts, normalized.accounts, (item) => item.accountId),
      modelMappings: mergeByKey(
        currentByName.modelMappings,
        normalized.modelMappings,
        (item) => `${item.providerId || ''}:${item.model}`,
      ),
    };
    const writes = IMPORT_COLLECTIONS.map((name) => writeCollectionUnlocked(name, next[name]));
    if (Object.keys(normalized.config).length > 0) {
      writes.push(writeCollection('config', {
        ...(currentConfig && !Array.isArray(currentConfig) ? currentConfig : {}),
        ...normalized.config,
      }));
    }
    await Promise.all(writes);
    return {
      config: cloneValue(normalized.config),
      counts: Object.fromEntries(IMPORT_COLLECTIONS.map((name) => [name, normalized[name].length])),
      accounts: normalized.accounts.map((account) => publicAccount(account)),
    };
  });

  const readLegacyData = async () => {
    let content;
    try {
      content = await fs.readFile(legacyDataPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        const missing = new Error(`未找到原 Chat2API 数据文件: ${legacyDataPath}`);
        missing.code = 'legacy_data_not_found';
        missing.statusCode = 404;
        throw missing;
      }
      throw error;
    }
    try {
      return JSON.parse(content);
    } catch (error) {
      const invalid = new Error('原 Chat2API data.json 格式错误，无法迁移');
      invalid.code = 'legacy_data_invalid';
      invalid.statusCode = 422;
      throw invalid;
    }
  };

  let legacyAccountRestore;
  // 仅恢复项目原有资料，按目录串行；已有账号/禁用状态优先，绝不读取任意浏览器。
  // 先原子保存账号再保存标记；中断重试通过身份与已有Provider去重，不丢失资料。
  const restoreLegacyAccounts = async () => {
    if (options.restoreLegacyAccounts === false) return false;
    // 自定义数据根（含手动导入/测试根）默认隔离，必须明确授权恢复，不能仅凭路径触发。
    if (rootDir !== path.resolve(DEFAULT_ROOT_DIR) && options.restoreLegacyAccounts !== true) return false;
    if (!legacyAccountRestore) legacyAccountRestore = withAccountLock(async () => {
      const marker = await readCollection('legacyAccountReuse', {});
      if (marker?.completed === true) return false;
      const stat = await fs.lstat(legacyDataPath).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return false;
      let source;
      try { source = JSON.parse(await fs.readFile(legacyDataPath, 'utf8')); }
      catch { return false; }
      if (!Array.isArray(source?.accounts) || source.accounts.length > MAX_IMPORT_ITEMS) return false;
      const current = await readCollection('accounts', []);
      ensureArray(current, 'accounts');
      const providers = new Set(current.map(account => canonicalProviderId(account.providerId)));
      const ids = new Set(current.map(account => account.accountId));
      const incoming = [];
      for (const value of source.accounts) {
        if (!['qwen', 'doubaochat', 'deepseek'].includes(canonicalProviderId(value?.providerId)) || providers.has(canonicalProviderId(value.providerId))) continue;
        try {
          const { id, name, ...fields } = value;
          const account = validateAccount({ ...fields, accountId: value.accountId || id, label: value.label || name });
          if (ids.has(account.accountId) || !hasConfiguredSecret(account)) continue;
          ids.add(account.accountId);
          incoming.push(account.providerId === 'doubaochat' ? resetDoubaoVerification(account) : account);
        } catch { /* 单条旧资料不合法时跳过；不影响已有账号，也不公开凭据内容。 */ }
      }
      if (incoming.length) await writeCollectionUnlocked('accounts', [...current, ...incoming]);
      await writeCollectionUnlocked('legacyAccountReuse', { schemaVersion: 1, completed: true });
      return incoming.length > 0;
    }).catch(error => { legacyAccountRestore = undefined; throw error; });
    return legacyAccountRestore;
  };

  const normalizeLegacyConfig = (legacyConfig = {}) => {
    const config = {};
    const mappings = legacyConfig.modelMappings && typeof legacyConfig.modelMappings === 'object' && !Array.isArray(legacyConfig.modelMappings)
      ? legacyConfig.modelMappings
      : {};
    if (typeof legacyConfig.proxyHost === 'string' && legacyConfig.proxyHost.trim()) config.host = legacyConfig.proxyHost.trim();
    if (Number.isInteger(Number(legacyConfig.proxyPort))) config.port = Number(legacyConfig.proxyPort);
    if (['round-robin', 'fill-first', 'failover'].includes(legacyConfig.loadBalanceStrategy)) config.loadBalanceStrategy = legacyConfig.loadBalanceStrategy;
    if (typeof legacyConfig.enableApiKey === 'boolean') config.enableApiKey = legacyConfig.enableApiKey;
    return { config, mappings };
  };

  const normalizeLegacyUserModelOverrides = (overrides = {}) => {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return [];
    return Object.entries(overrides).flatMap(([providerId, override]) => {
      const addedModels = override && Array.isArray(override.addedModels) ? override.addedModels : [];
      return addedModels.map((model) => ({
        model: ensureId(model && model.displayName, 'model', '原 Chat2API 用户模型映射'),
        actualModel: ensureId(model && model.actualModelId, 'actualModel', '原 Chat2API 用户模型映射'),
        providerId: ensureId(providerId, 'providerId', '原 Chat2API 用户模型映射'),
      }));
    });
  };

  const normalizeLegacyImport = (data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('原 Chat2API 数据必须是对象');
    }
    const providers = ensureArray(data.providers || [], 'providers').map((provider) => ({
      ...cloneValue(provider),
      providerId: ensureId(provider.providerId || provider.id, 'providerId', '原 Chat2API Provider'),
    }));
    const accounts = ensureArray(data.accounts || [], 'accounts').map((account) => validateAccount({
      ...cloneValue(account),
      accountId: ensureId(account.accountId || account.id, 'accountId', '原 Chat2API 账号'),
      label: account.label || account.name,
    }));
    const { config, mappings } = normalizeLegacyConfig(data.config);
    const configModelMappings = Object.entries(mappings).map(([model, mapping]) => ({
      model: mapping && mapping.requestModel ? mapping.requestModel : model,
      actualModel: mapping && mapping.actualModel ? mapping.actualModel : model,
      ...(mapping && mapping.preferredProviderId ? { providerId: mapping.preferredProviderId } : {}),
    }));
    const modelMappings = [...configModelMappings, ...normalizeLegacyUserModelOverrides(data.userModelOverrides)];
    const payload = normalizeImport({ version: 1, providers, accounts, modelMappings });
    return { payload, config };
  };

  const previewLegacyImport = async () => {
    const normalized = normalizeLegacyImport(await readLegacyData());
    return { ...importPreview({ version: 1, ...normalized.payload }), source: legacyDataPath, config: normalized.config };
  };

  const mergeLegacyImport = async (confirmed) => {
    if (confirmed !== true) {
      throw new Error('Chat2API 导入必须先预览并明确确认');
    }
    const normalized = normalizeLegacyImport(await readLegacyData());
    const result = await mergeImport({ version: 1, ...normalized.payload }, true);
    if (Object.keys(normalized.config).length > 0) {
      const current = await readCollection('config', {});
      await writeCollection('config', { ...(current && !Array.isArray(current) ? current : {}), ...normalized.config });
    }
    return { ...result, config: normalized.config };
  };

  return {
    rootDir,
    readCollection,
    writeCollection,
    exportConfiguration,
    exportAccountCredentials,
    previewAccountImport,
    mergeAccountImport,
    saveAccount,
    refreshDoubaoCookieSnapshot,
    listAccounts,
    listDoubaoNodeAccountIds,
    getAccount,
    updateAccount,
    updateAccountVerification,
    markDoubaoNodeChatVerified,
    markDoubaoBrowserChatVerified,
    deleteAccount,
    listModelMappings,
    listEffectiveModelMappings,
    saveModelMapping,
    deleteModelMapping,
    createOAuthSession,
    getOAuthSession,
    consumeOAuthSession,
    cancelOAuthSession,
    clearOAuthSessions,
    createApiKey,
    listApiKeys,
    validateApiKey,
    updateApiKey,
    disableApiKey,
    deleteApiKey,
    previewImport,
    mergeImport,
    previewLegacyImport,
    mergeLegacyImport,
  };
};

module.exports = {
  DEFAULT_ROOT_DIR,
  DEFAULT_LEGACY_DATA_PATH,
  ACCOUNT_EXPORT_FORMAT,
  accountCredentialVersion,
  createChat2ApiDataStore,
};
