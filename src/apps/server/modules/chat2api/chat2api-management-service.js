const DEFAULT_CONFIG = Object.freeze({
  host: '127.0.0.1',
  port: 8080,
  timeout: 120_000,
  loadBalanceStrategy: 'round-robin',
  enableApiKey: true,
  debugRawTraffic: false,
  rawTrafficMaxBytes: 256 * 1024,
});

const createChat2ApiManagementService = (runtime) => {
  if (!runtime || !runtime.dataStore || !runtime.providerRegistry || !runtime.oauth) {
    throw new Error('Chat2API 管理服务需要完整 runtime');
  }
  const { dataStore, providerRegistry, oauth } = runtime;

  const getConfig = async () => {
    const stored = await dataStore.readCollection('config', {});
    return { ...DEFAULT_CONFIG, ...(stored && !Array.isArray(stored) ? stored : {}) };
  };

  const saveConfig = async (input = {}) => {
    const current = await getConfig();
    const next = { ...current, ...input };
    if (!['round-robin', 'fill-first', 'failover'].includes(next.loadBalanceStrategy)) {
      throw new Error('负载均衡策略无效');
    }
    if (!Number.isInteger(Number(next.port)) || Number(next.port) < 0 || Number(next.port) > 65535) {
      throw new Error('代理端口无效');
    }
    if (typeof next.debugRawTraffic !== 'boolean') {
      throw new Error('debugRawTraffic 必须是布尔值');
    }
    if (!Number.isInteger(Number(next.rawTrafficMaxBytes)) || Number(next.rawTrafficMaxBytes) < 1024 || Number(next.rawTrafficMaxBytes) > 2 * 1024 * 1024) {
      throw new Error('rawTrafficMaxBytes 必须是 1024 到 2097152 之间的整数');
    }
    await dataStore.writeCollection('config', { ...next, port: Number(next.port), rawTrafficMaxBytes: Number(next.rawTrafficMaxBytes) });
    return getConfig();
  };

  const listProviders = () => providerRegistry.listProviders();
  const saveProvider = (provider) => providerRegistry.saveProvider(provider);
  const listAccounts = () => dataStore.listAccounts();
  const updateAccount = (accountId, patch) => dataStore.updateAccount(accountId, patch);
  const deleteAccount = (accountId) => dataStore.deleteAccount(accountId);
  const listModelMappings = () => dataStore.listModelMappings();
  const saveModelMapping = (mapping) => dataStore.saveModelMapping(mapping);
  const deleteModelMapping = (model) => dataStore.deleteModelMapping(model);
  const startLogin = (providerId) => oauth.startLogin(providerId);
  const completeLogin = (input) => oauth.completeLogin(input);
  const handleCallback = (query) => oauth.handleCallback(query);
  const createApiKey = (input) => dataStore.createApiKey(input);
  const listApiKeys = () => dataStore.listApiKeys();
  const updateApiKey = (id, patch) => dataStore.updateApiKey(id, patch);
  const disableApiKey = (id) => dataStore.disableApiKey(id);
  const deleteApiKey = (id) => dataStore.deleteApiKey(id);
  const deleteProvider = async (providerId) => providerRegistry.deleteProvider(providerId, {
    accounts: await dataStore.listAccounts(),
    mappings: await dataStore.listModelMappings(),
  });
  const previewImport = (input) => dataStore.previewImport(input);
  const mergeImport = (input, confirmed) => dataStore.mergeImport(input, confirmed);
  const previewLegacyImport = () => dataStore.previewLegacyImport();
  const mergeLegacyImport = (confirmed) => dataStore.mergeLegacyImport(confirmed);

  return {
    getConfig,
    saveConfig,
    listProviders,
    saveProvider,
    listAccounts,
    updateAccount,
    deleteAccount,
    listModelMappings,
    saveModelMapping,
    deleteModelMapping,
    deleteProvider,
    startLogin,
    completeLogin,
    handleCallback,
    createApiKey,
    listApiKeys,
    updateApiKey,
    disableApiKey,
    deleteApiKey,
    previewImport,
    mergeImport,
    previewLegacyImport,
    mergeLegacyImport,
  };
};

module.exports = { DEFAULT_CONFIG, createChat2ApiManagementService };
