const { createChat2ApiDataStore } = require('./chat2api-data-store');
const { createChat2ApiProviderRegistry } = require('./chat2api-provider-registry');
const { createChat2ApiModelMapper } = require('./chat2api-model-mapper');
const { createChat2ApiLoadBalancer } = require('./chat2api-load-balancer');
const { createChat2ApiCoreAdapter } = require('./chat2api-core-adapter');
const { createChat2ApiOAuthService } = require('./chat2api-oauth-service');
const { createChat2ApiProxyService } = require('./chat2api-proxy-service');
const { createChat2ApiManagementService } = require('./chat2api-management-service');
const { createChat2ApiProviderAdapters } = require('./chat2api-provider-adapters');
const { createRawTrafficLogger } = require('./chat2api-raw-traffic-logger');

const createChat2ApiRuntime = (options = {}) => {
  const dataStore = options.dataStore || createChat2ApiDataStore({ rootDir: options.rootDir });
  const providerRegistry = options.providerRegistry || createChat2ApiProviderRegistry({ dataStore });
  const modelMapper = options.modelMapper || createChat2ApiModelMapper({ dataStore });
  const loadBalancer = options.loadBalancer || createChat2ApiLoadBalancer({ providerRegistry, dataStore, modelMapper });
  const rawTrafficLogger = options.rawTrafficLogger || createRawTrafficLogger();
  const getConfig = options.getChat2ApiConfig || (() => dataStore.readCollection('config', {}));
  const coreAdapter = options.coreAdapter || createChat2ApiCoreAdapter({
    dataStore,
    providerRegistry,
    modelMapper,
    loadBalancer,
    providerAdapters: options.providerAdapters || createChat2ApiProviderAdapters({ httpClient: options.httpClient, rawTrafficLogger, getConfig }),
  });
  const oauth = options.oauth || createChat2ApiOAuthService({
    dataStore,
    providerRegistry,
    credentialAdapters: options.credentialAdapters || {},
  });
  const managementService = options.managementService || createChat2ApiManagementService({ dataStore, providerRegistry, oauth });
  const proxy = options.proxy || createChat2ApiProxyService({
    host: options.host,
    port: options.port,
    config: options.config,
    dataStore,
    coreAdapter,
    managementService,
  });

  const start = async () => proxy.start();
  const stop = async () => {
    await oauth.stop();
    await proxy.stop();
  };
  const getStatus = () => ({
    running: proxy.isRunning(),
    address: proxy.address(),
  });

  return { dataStore, providerRegistry, modelMapper, loadBalancer, rawTrafficLogger, coreAdapter, oauth, managementService, proxy, start, stop, getStatus };
};

module.exports = { createChat2ApiRuntime };
