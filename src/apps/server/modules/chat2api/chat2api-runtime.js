const { createChat2ApiDataStore, accountCredentialVersion } = require('./chat2api-data-store');
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
const { createDoubaoSignatureStore } = require('./chat2api-doubao-signature-store');
const { createChat2ApiResponsesService } = require('./chat2api-responses-service');
const { createChat2ApiQwenHistoryService } = require('./chat2api-qwen-history-service');
const { createChat2ApiCredentialValidators } = require('./chat2api-credential-validators');
const { createChat2ApiManualAccountService } = require('./chat2api-manual-account-service');
const { createChat2ApiAccountWebSessionService } = require('./chat2api-account-web-session-service');
const { createChat2ApiSpeechService } = require('./chat2api-speech-service');
const {createChat2ApiApplicationService}=require('./chat2api-application-service');
const { createDoubaoAccountVerifier } = require('./chat2api-doubao-account-verifier');
const { createChat2ApiAccountVerificationService } = require('./chat2api-account-verification-service');
const { doubaoWebTaskBridge, getDoubaoWebTaskStatus } = require('./chat2api-doubao-web-task-registry');

const { acquireDoubaoBrowserPort } = require('./chat2api-doubao-browser-port');

const createChat2ApiRuntime = (options = {}) => {
  const dataStore = options.dataStore || createChat2ApiDataStore({ rootDir: options.rootDir, legacyDataPath: options.legacyDataPath,
    restoreLegacyAccounts: options.restoreLegacyAccounts });
  const providerRegistry = options.providerRegistry || createChat2ApiProviderRegistry({ dataStore });
  const modelMapper = options.modelMapper || createChat2ApiModelMapper({ dataStore });
  const loadBalancer = options.loadBalancer || createChat2ApiLoadBalancer({ providerRegistry, dataStore, modelMapper });
  const rawTrafficLogger = options.rawTrafficLogger || createRawTrafficLogger();
  const getConfig = options.getChat2ApiConfig || (() => dataStore.readCollection('config', {}));
  const getDoubaoTransport = options.getDoubaoTransport
    || (() => getDoubaoWebTaskStatus().running ? 'browser-fetch' : 'node-http');
  const speechService = options.speechService || createChat2ApiSpeechService({ dataStore, providerRegistry, loadBalancer, getConfig, modelMapper,
    doubaoSpeechQueue: options.doubaoSpeechQueue,
    qwenApiRateGate: options.qwenApiRateGate,
    qwenChatRateGate: options.qwenChatRateGate,
    ...(options.apiSpeechAdapters?{apiAdapters:options.apiSpeechAdapters}:{}),
    ...(options.doubaoSpeechAdapter ? { doubaoAdapter: options.doubaoSpeechAdapter } : {}),
    ...(options.qwenSpeechAdapter ? { qwenAdapter: options.qwenSpeechAdapter } : {}) });
  const browserPort = !options.coreAdapter && !options.providerAdapters && !options.doubaoBrowserBridge
    ? acquireDoubaoBrowserPort({ rootDir: dataStore.rootDir }) : null;
  const browserBridge = options.doubaoBrowserBridge || {
    request: args => doubaoWebTaskBridge.request(args),
    prepare: args => browserPort.prepare(args),
  };
  const coreAdapter = options.coreAdapter || createChat2ApiCoreAdapter({
    dataStore,
    providerRegistry,
    modelMapper,
    loadBalancer,
    providerAdapters: options.providerAdapters || createChat2ApiProviderAdapters({ httpClient: options.httpClient, rawTrafficLogger, getConfig,
      doubaoBrowserBridge: browserBridge,
      getDoubaoTransport, getDoubaoWebViewSettings: options.getDoubaoWebViewSettings,
      doubaoSignatureStore: options.doubaoSignatureStore || (dataStore.rootDir
        ? createDoubaoSignatureStore({ rootDir: dataStore.rootDir }) : undefined),
      onDoubaoChatVerified: account => dataStore.markDoubaoNodeChatVerified?.(account.accountId, accountCredentialVersion(account)),
      onDoubaoBrowserChatVerified: account => dataStore.markDoubaoBrowserChatVerified?.(account.accountId, accountCredentialVersion(account)) }),
  });
  const responseSessionStore = options.responseSessionStore || createChat2ApiResponseSessionStore({ dataStore });
  const applicationService=createChat2ApiApplicationService({modelMapper,speechService});
  const responsesService = options.responsesService || createChat2ApiResponsesService({
    sessionStore: responseSessionStore, coreAdapter, applicationService, getDoubaoTransport });
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
    doubaoMediaService: options.doubaoMediaService,
    doubaoFileService: options.doubaoFileService,
  });

  const start = async () => proxy.start();
  const stop = async () => {
    await oauth.stop();
    accountWebSession.clear();
    try { await proxy.stop(); }
    finally { await browserPort?.stop(); }
  };
  const getStatus = () => ({
    running: proxy.isRunning(),
    address: proxy.address(),
  });

  return { dataStore, providerRegistry, modelMapper, loadBalancer, rawTrafficLogger, coreAdapter, speechService, responseSessionStore, responsesService, qwenHistoryService, oauth, manualAccount, accountWebSession, accountVerificationService, managementService, proxy, start, stop, getStatus };
};

module.exports = { createChat2ApiRuntime };
