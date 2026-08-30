const DEFAULT_CONFIG = Object.freeze({
  host: '127.0.0.1',
  port: 8080,
  timeout: 120_000,
  loadBalanceStrategy: 'round-robin',
  enableApiKey: true,
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
    await dataStore.writeCollection('config', { ...next, port: Number(next.port) });
    return getConfig();
  };

  const listProviders = () => providerRegistry.listProviders();
  const saveProvider = (provider) => providerRegistry.saveProvider(provider);
  const listAccounts = () => dataStore.listAccounts();
  const startLogin = (providerId) => oauth.startLogin(providerId);
  const completeLogin = (input) => oauth.completeLogin(input);
  const handleCallback = (query) => oauth.handleCallback(query);
  const createApiKey = (input) => dataStore.createApiKey(input);
  const listApiKeys = () => dataStore.listApiKeys();
  const previewImport = (input) => dataStore.previewImport(input);
  const mergeImport = (input, confirmed) => dataStore.mergeImport(input, confirmed);

  return {
    getConfig,
    saveConfig,
    listProviders,
    saveProvider,
    listAccounts,
    startLogin,
    completeLogin,
    handleCallback,
    createApiKey,
    listApiKeys,
    previewImport,
    mergeImport,
  };
};

module.exports = { DEFAULT_CONFIG, createChat2ApiManagementService };
