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
const COLLECTION_FILES = Object.freeze({
  config: 'config.json',
  providers: 'providers.json',
  accounts: 'accounts.json',
  apiKeys: 'api-keys.json',
  modelMappings: 'model-mappings.json',
});
const IMPORT_COLLECTIONS = Object.freeze(['providers', 'accounts', 'modelMappings']);
const MAX_IMPORT_ITEMS = 1000;

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
  const filePath = (name) => path.join(rootDir, COLLECTION_FILES[name]);

  const ensurePrivateDirectory = async () => {
    await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
    // 目录可能是历史版本创建的，显式修正权限，避免凭据目录被组用户读取。
    await fs.chmod(rootDir, 0o700);
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

  const normalizeImport = (data) => {
    if (!data || typeof data !== 'object' || data.version !== 1) {
      throw new Error('Chat2API 导入文件版本不受支持');
    }
    const providers = ensureArray(data.providers || [], 'providers');
    const accounts = ensureArray(data.accounts || [], 'accounts').map((account) => validateAccount(account));
    const modelMappings = ensureArray(data.modelMappings || [], 'modelMappings');
    providers.forEach((provider) => ensureId(provider.providerId, 'providerId', 'Chat2API Provider'));
    modelMappings.forEach((mapping) => ensureId(mapping.model, 'model', 'Chat2API 模型映射'));
    return {
      providers: cloneValue(providers),
      accounts,
      modelMappings: cloneValue(modelMappings),
    };
  };

  const importPreview = (data) => {
    const normalized = normalizeImport(data);
    return {
      version: 1,
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
    const current = await Promise.all(IMPORT_COLLECTIONS.map((name) => readCollection(name, [])));
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
    await Promise.all(IMPORT_COLLECTIONS.map((name) => writeCollection(name, next[name])));
    return {
      counts: Object.fromEntries(IMPORT_COLLECTIONS.map((name) => [name, normalized[name].length])),
      accounts: normalized.accounts.map((account) => publicAccount(account)),
    };
  };

  return {
    rootDir,
    readCollection,
    writeCollection,
    saveAccount,
    listAccounts,
    createApiKey,
    listApiKeys,
    validateApiKey,
    previewImport,
    mergeImport,
  };
};

module.exports = {
  DEFAULT_ROOT_DIR,
  createChat2ApiDataStore,
};
