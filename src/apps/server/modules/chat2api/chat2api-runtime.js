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
const { createChat2ApiResponseSessionStore } = require('./chat2api-response-session-store');
const { createChat2ApiResponsesService } = require('./chat2api-responses-service');
const { createChat2ApiQwenHistoryService } = require('./chat2api-qwen-history-service');
const { createChat2ApiCredentialValidators } = require('./chat2api-credential-validators');
const { createChat2ApiManualAccountService } = require('./chat2api-manual-account-service');
const { createChat2ApiAccountWebSessionService } = require('./chat2api-account-web-session-service');
const { createChat2ApiSpeechService } = require('./chat2api-speech-service');
const {createChat2ApiApplicationService}=require('./chat2api-application-service');
const { createDoubaoBrowserBridge } = require('./chat2api-doubao-browser-bridge');
const { createDoubaoAccountVerifier } = require('./chat2api-doubao-account-verifier');
const { createChat2ApiAccountVerificationService } = require('./chat2api-account-verification-service');

const createChat2ApiRuntime = (options = {}) => {
  const dataStore = options.dataStore || createChat2ApiDataStore({ rootDir: options.rootDir });
  const providerRegistry = options.providerRegistry || createChat2ApiProviderRegistry({ dataStore });
  const modelMapper = options.modelMapper || createChat2ApiModelMapper({ dataStore });
  const loadBalancer = options.loadBalancer || createChat2ApiLoadBalancer({ providerRegistry, dataStore, modelMapper });
  const rawTrafficLogger = options.rawTrafficLogger || createRawTrafficLogger();
  const getConfig = options.getChat2ApiConfig || (() => dataStore.readCollection('config', {}));
  // 统一读取主服务WS权威配置；无配置时由规范化器使用disabled默认值，构造runtime不会连接Chrome。
  const getDoubaoWebConfig = options.getDoubaoWebConfig || (() => require('../config/config-app-service').get('doubaoWebRuntime', {}));
  const doubaoBrowser = options.doubaoBrowserTransport || createDoubaoBrowserBridge({getConfig:getDoubaoWebConfig,dataStore});
  const speechService = options.speechService || createChat2ApiSpeechService({ dataStore, providerRegistry, loadBalancer, getConfig, modelMapper,
    ...(options.apiSpeechAdapters?{apiAdapters:options.apiSpeechAdapters}:{}),
    ...(options.doubaoSpeechAdapter ? { doubaoAdapter: options.doubaoSpeechAdapter } : {}),
    ...(options.qwenSpeechAdapter ? { qwenAdapter: options.qwenSpeechAdapter } : {}) });
  const coreAdapter = options.coreAdapter || createChat2ApiCoreAdapter({
    dataStore,
    providerRegistry,
    modelMapper,
    loadBalancer,
    providerAdapters: options.providerAdapters || createChat2ApiProviderAdapters({ httpClient: options.httpClient, rawTrafficLogger, getConfig, doubaoBrowserTransport:doubaoBrowser }),
    getDoubaoWebConfig,
  });
  const responseSessionStore = options.responseSessionStore || createChat2ApiResponseSessionStore({ dataStore });
  const applicationService=createChat2ApiApplicationService({modelMapper,speechService});
  const responsesService = options.responsesService || createChat2ApiResponsesService({ sessionStore: responseSessionStore, coreAdapter, applicationService });
  const qwenHistoryService = options.qwenHistoryService || createChat2ApiQwenHistoryService({
    dataStore,
    providerRegistry,
    httpClient: options.httpClient,
    projectRoot: options.projectRoot,
  });
  const doubaoAccountVerifier = options.doubaoAccountVerifier || createDoubaoAccountVerifier({ httpClient: options.httpClient });
  const credentialAdapters = options.credentialAdapters || createChat2ApiCredentialValidators({ httpClient: options.httpClient, doubaoVerifier: doubaoAccountVerifier });
  const accountVerificationService = options.accountVerificationService || createChat2ApiAccountVerificationService({ dataStore, providerRegistry, verifier: doubaoAccountVerifier });
  const oauth = options.oauth || createChat2ApiOAuthService({
    dataStore,
    providerRegistry,
    credentialAdapters,
  });
  const manualAccount = options.manualAccount || createChat2ApiManualAccountService({ dataStore, providerRegistry, credentialAdapters });
  const accountWebSession = options.accountWebSession || createChat2ApiAccountWebSessionService({
    dataStore,
    providerRegistry,
    baseUrl: options.accountWebSessionBaseUrl || `http://${options.host || '127.0.0.1'}:${options.port || 8080}`,
  });
  const managementService = options.managementService || createChat2ApiManagementService({ dataStore, providerRegistry, oauth, manualAccount, accountWebSession, qwenHistoryService, accountVerificationService });
  const proxy = options.proxy || createChat2ApiProxyService({
    host: options.host,
    port: options.port,
    config: options.config,
    dataStore,
    coreAdapter,
    responsesService,
    managementService,
    speechService,
  });

  const start = async () => proxy.start();
  const stop = async () => {
    doubaoBrowser.cancel?.();
    await oauth.stop();
    accountWebSession.clear();
    await proxy.stop();
  };
  const getStatus = () => ({
    running: proxy.isRunning(),
    address: proxy.address(),
  });

  return { dataStore, providerRegistry, modelMapper, loadBalancer, rawTrafficLogger, coreAdapter, speechService, responseSessionStore, responsesService, qwenHistoryService, oauth, manualAccount, accountWebSession, accountVerificationService, managementService, proxy, start, stop, getStatus };
};

module.exports = { createChat2ApiRuntime };
