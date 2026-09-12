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

const DEFAULT_ROOT_DIR = path.join(os.homedir(), '.config', 'aasc-user', 'chat2api');
const DEFAULT_LEGACY_DATA_PATH = path.join(os.homedir(), '.chat2api', 'data.json');
const COLLECTION_FILES = Object.freeze({
  config: 'config.json',
  providers: 'providers.json',
  accounts: 'accounts.json',
  apiKeys: 'api-keys.json',
  modelMappings: 'model-mappings.json',
  responsesSessions: 'responses-sessions.json',
});
const EXPORT_FORMAT = 'aasc-chat2api-config';
const IMPORT_COLLECTIONS = Object.freeze(['providers', 'accounts', 'modelMappings']);
const MAX_IMPORT_ITEMS = 1000;
const OAUTH_SESSION_TTL_MS = 5 * 60 * 1000;

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

  const writeCollection = async (name, value) => {
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

  const validateAccount = (account) => {
    if (!account || typeof account !== 'object') {
      throw new Error('Chat2API 账号必须是对象');
    }
    const accountId = ensureId(account.accountId, 'accountId', 'Chat2API 账号');
    const providerId = ensureId(account.providerId, 'providerId', 'Chat2API 账号');
    return { ...cloneValue(account), accountId, providerId };
  };

  const publicAccount = (account) => ({
    ...sanitizeSecrets(account),
    secretConfigured: hasConfiguredSecret(account),
  });

  const saveAccount = async (account) => {
    const normalized = validateAccount(account);
    const current = await readCollection('accounts', []);
    const next = mergeByKey(current, [normalized], (item) => item.accountId);
    await writeCollection('accounts', next);
    return publicAccount(normalized);
  };

  const listAccounts = async () => {
    const accounts = await readCollection('accounts', []);
    ensureArray(accounts, 'accounts');
    return accounts.map((account) => publicAccount(account));
  };

  const getAccount = async (accountId) => {
    const accounts = await readCollection('accounts', []);
    ensureArray(accounts, 'accounts');
    return accounts.find((account) => account.accountId === accountId) || null;
  };

  const updateAccount = async (accountId, patch = {}) => {
    const current = await getAccount(accountId);
    if (!current) {
      return null;
    }
    const next = validateAccount({ ...current, ...patch, accountId: current.accountId, providerId: current.providerId, credentials: patch.credentials || current.credentials });
    const accounts = await readCollection('accounts', []);
    await writeCollection('accounts', accounts.map((account) => account.accountId === accountId ? next : account));
    return publicAccount(next);
  };

  const deleteAccount = async (accountId) => {
    const accounts = await readCollection('accounts', []);
    const next = accounts.filter((account) => account.accountId !== accountId);
    if (next.length === accounts.length) {
      return false;
    }
    await writeCollection('accounts', next);
    return true;
  };

  const listModelMappings = async () => {
    const mappings = await readCollection('modelMappings', []);
    ensureArray(mappings, 'modelMappings');
    return cloneValue(mappings);
  };

  const saveModelMapping = async (mapping) => {
    if (!mapping || typeof mapping.model !== 'string' || mapping.model.trim().length === 0 || typeof mapping.actualModel !== 'string' || mapping.actualModel.trim().length === 0) {
      throw new Error('Chat2API 模型映射必须包含 model 和 actualModel');
    }
    const normalized = { ...cloneValue(mapping), model: mapping.model.trim(), actualModel: mapping.actualModel.trim() };
    const mappings = await listModelMappings();
    await writeCollection('modelMappings', mergeByKey(mappings, [normalized], (item) => item.model));
    return normalized;
  };

  const deleteModelMapping = async (model) => {
    const mappings = await listModelMappings();
    const next = mappings.filter((mapping) => mapping.model !== model);
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
      accounts: cloneValue(accounts),
      modelMappings: cloneValue(modelMappings),
    };
  };

  const normalizeImport = (data) => {
    if (!data || typeof data !== 'object' || data.version !== 1) {
      throw new Error('Chat2API 导入文件版本不受支持');
    }
    if (data.format !== undefined && data.format !== EXPORT_FORMAT) {
      throw new Error('Chat2API 导入文件格式不受支持');
    }
    const providers = ensureArray(data.providers || [], 'providers');
    const accounts = ensureArray(data.accounts || [], 'accounts').map((account) => validateAccount(account));
    const modelMappings = ensureArray(data.modelMappings || [], 'modelMappings');
    providers.forEach((provider) => ensureId(provider.providerId, 'providerId', 'Chat2API Provider'));
    modelMappings.forEach((mapping) => ensureId(mapping.model, 'model', 'Chat2API 模型映射'));
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

  const mergeImport = async (data, confirmed) => {
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
    const writes = IMPORT_COLLECTIONS.map((name) => writeCollection(name, next[name]));
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
  };

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
    saveAccount,
    listAccounts,
    getAccount,
    updateAccount,
    deleteAccount,
    listModelMappings,
    saveModelMapping,
    deleteModelMapping,
    createOAuthSession,
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
  createChat2ApiDataStore,
};
