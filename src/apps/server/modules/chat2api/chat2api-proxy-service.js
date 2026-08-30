const http = require('http');

const DEFAULT_CONFIG = Object.freeze({
  host: '127.0.0.1',
  port: 8080,
  enableApiKey: true,
  bodyLimit: 50 * 1024 * 1024,
});

const createChat2ApiProxyService = (options = {}) => {
  const config = { ...DEFAULT_CONFIG, ...(options.config || {}), host: options.host || options.config?.host || DEFAULT_CONFIG.host, port: options.port ?? options.config?.port ?? DEFAULT_CONFIG.port };
  const dataStore = options.dataStore;
  const coreAdapter = options.coreAdapter;
  const managementService = options.managementService;
  const responsesService = options.responsesService;
  let server = null;
  const sockets = new Set();
  const statistics = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
  };

  const sendJson = (response, statusCode, payload) => {
    const body = JSON.stringify(payload);
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Length', Buffer.byteLength(body));
    response.end(body);
  };

  const sendError = (response, error) => {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const code = error.code || 'internal_error';
    const message = statusCode >= 500 && !error.code ? 'Chat2API 代理内部错误' : error.message;
    sendJson(response, statusCode, { error: { message, type: statusCode >= 500 ? 'api_error' : 'invalid_request_error', code } });
  };

  const readJson = async (request) => {
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > config.bodyLimit) {
        const error = new Error('请求体过大');
        error.statusCode = 413;
        error.code = 'request_too_large';
        throw error;
      }
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch (error) {
      error.statusCode = 400;
      error.code = 'invalid_json';
      error.message = '请求体不是有效 JSON';
      throw error;
    }
  };

  const authorize = async (request, pathname) => {
    const remoteAddress = request.socket && request.socket.remoteAddress;
    const isLocalRequest = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
    if (!config.enableApiKey || pathname === '/health' || pathname === '/' || (pathname.startsWith('/api/chat2api') && isLocalRequest)) {
      return true;
    }
    if (!dataStore || typeof dataStore.validateApiKey !== 'function') {
      const error = new Error('代理鉴权服务不可用');
      error.statusCode = 503;
      error.code = 'auth_unavailable';
      throw error;
    }
    const header = request.headers.authorization || '';
    const value = header.startsWith('Bearer ') ? header.slice(7).trim() : request.headers['x-api-key'];
    if (!value) {
      const error = new Error('需要 API Key');
      error.statusCode = 401;
      error.code = 'missing_api_key';
      throw error;
    }
    if (!(await dataStore.validateApiKey(value))) {
      const error = new Error('API Key 无效');
      error.statusCode = 401;
      error.code = 'invalid_api_key';
      throw error;
    }
    return true;
  };

  const writeStream = async (response, stream) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    for await (const chunk of stream) {
      if (response.writableEnded) {
        break;
      }
      const data = typeof chunk === 'string' && chunk.startsWith('data:') ? chunk : JSON.stringify(chunk);
      response.write(`data: ${data}\n\n`);
    }
    if (!response.writableEnded) {
      response.end('data: [DONE]\n\n');
    }
  };

  const writeResponsesStream = async (response, stream) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    for await (const event of stream) {
      if (response.writableEnded) break;
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    if (!response.writableEnded) response.end('data: [DONE]\n\n');
  };

  const handleRequest = async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }
    const url = new URL(request.url || '/', `http://${config.host}`);
    await authorize(request, url.pathname);
    if (request.method === 'GET' && url.pathname === '/') {
      sendJson(response, 200, { name: 'AASC Chat2API Proxy', endpoints: ['/v1/chat/completions', '/v1/responses', '/v1/completions', '/v1/models'] });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { status: 'running', address: service.address(), statistics: { ...statistics, activeConnections: sockets.size } });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/stats') {
      sendJson(response, 200, { ...statistics, activeConnections: sockets.size });
      return;
    }
    if (url.pathname.startsWith('/api/chat2api')) {
      if (!managementService) {
        const error = new Error('Chat2API 管理服务不可用');
        error.statusCode = 503;
        error.code = 'management_unavailable';
        throw error;
      }
      const body = ['POST', 'PUT'].includes(request.method) ? await readJson(request) : null;
      const managementResult = await (async () => {
        if (request.method === 'GET' && url.pathname === '/api/chat2api/config') return managementService.getConfig();
        if (request.method === 'PUT' && url.pathname === '/api/chat2api/config') return managementService.saveConfig(body);
        if (request.method === 'GET' && url.pathname === '/api/chat2api/providers') return managementService.listProviders();
        if (['POST', 'PUT'].includes(request.method) && url.pathname === '/api/chat2api/providers') return managementService.saveProvider(body);
        if (request.method === 'DELETE' && url.pathname.startsWith('/api/chat2api/providers/')) return managementService.deleteProvider(decodeURIComponent(url.pathname.split('/').pop()));
        if (request.method === 'GET' && url.pathname === '/api/chat2api/accounts') return managementService.listAccounts();
        if (request.method === 'PUT' && url.pathname.startsWith('/api/chat2api/accounts/')) return managementService.updateAccount(decodeURIComponent(url.pathname.split('/').pop()), body);
        if (request.method === 'DELETE' && url.pathname.startsWith('/api/chat2api/accounts/')) return managementService.deleteAccount(decodeURIComponent(url.pathname.split('/').pop()));
        if (request.method === 'GET' && url.pathname === '/api/chat2api/model-mappings') return managementService.listModelMappings();
        if (['POST', 'PUT'].includes(request.method) && url.pathname === '/api/chat2api/model-mappings') return managementService.saveModelMapping(body);
        if (request.method === 'DELETE' && url.pathname.startsWith('/api/chat2api/model-mappings/')) return managementService.deleteModelMapping(decodeURIComponent(url.pathname.split('/').pop()));
        if (request.method === 'POST' && url.pathname === '/api/chat2api/oauth/start') return managementService.startLogin(body && body.providerId);
        if (request.method === 'POST' && url.pathname === '/api/chat2api/oauth/complete') return managementService.completeLogin(body);
        if (request.method === 'GET' && url.pathname === '/api/chat2api/oauth/callback') return managementService.handleCallback(Object.fromEntries(url.searchParams.entries()));
        if (request.method === 'GET' && url.pathname === '/api/chat2api/api-keys') return managementService.listApiKeys();
        if (request.method === 'POST' && url.pathname === '/api/chat2api/api-keys') return managementService.createApiKey(body);
        if (request.method === 'PUT' && url.pathname.startsWith('/api/chat2api/api-keys/')) return managementService.updateApiKey(decodeURIComponent(url.pathname.split('/').pop()), body);
        if (request.method === 'DELETE' && url.pathname.startsWith('/api/chat2api/api-keys/')) return managementService.deleteApiKey(decodeURIComponent(url.pathname.split('/').pop()));
        if (request.method === 'POST' && url.pathname === '/api/chat2api/import/preview') return managementService.previewImport(body);
        if (request.method === 'POST' && url.pathname === '/api/chat2api/import/merge') return managementService.mergeImport(body && body.data, body && body.confirmed);
        if (request.method === 'POST' && url.pathname === '/api/chat2api/import/legacy/preview') return managementService.previewLegacyImport();
        if (request.method === 'POST' && url.pathname === '/api/chat2api/import/legacy/merge') return managementService.mergeLegacyImport(body && body.confirmed);
        const error = new Error(`管理路由不存在: ${request.method} ${url.pathname}`);
        error.statusCode = 404;
        error.code = 'not_found';
        throw error;
      })();
      sendJson(response, 200, await managementResult);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      sendJson(response, 200, await coreAdapter.listModels());
      return;
    }
    if (request.method === 'POST' && ['/v1/chat/completions', '/v1/completions'].includes(url.pathname)) {
      const payload = await readJson(request);
      const chatRequest = url.pathname === '/v1/completions'
        ? { ...payload, messages: [{ role: 'user', content: payload.prompt || '' }] }
        : payload;
      const result = await coreAdapter.forwardChatCompletion(chatRequest);
      if (result.stream) {
        await writeStream(response, result.stream);
        return;
      }
      sendJson(response, 200, result.body);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/responses') {
      if (!responsesService || typeof responsesService.createResponse !== 'function') {
        const error = new Error('Responses 兼容服务不可用');
        error.statusCode = 503;
        error.code = 'responses_unavailable';
        throw error;
      }
      const result = await responsesService.createResponse(await readJson(request));
      if (result.stream) {
        await writeResponsesStream(response, result.stream);
        return;
      }
      sendJson(response, 200, result.body);
      return;
    }
    const error = new Error(`路由不存在: ${request.method} ${url.pathname}`);
    error.statusCode = 404;
    error.code = 'not_found';
    throw error;
  };

  const start = async () => {
    if (server && server.listening) {
      return service.address();
    }
    server = http.createServer((request, response) => {
      statistics.totalRequests += 1;
      handleRequest(request, response).then(() => {
        statistics.successRequests += 1;
      }).catch((error) => {
        statistics.failedRequests += 1;
        if (!response.headersSent) {
          sendError(response, error);
        } else {
          response.destroy(error);
        }
      });
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, resolve);
    });
    return service.address();
  };

  const stop = async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    if (!server || !server.listening) {
      server = null;
      return;
    }
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    server = null;
  };

  const service = {
    start,
    stop,
    address: () => (server && server.listening ? server.address() : null),
    isRunning: () => Boolean(server && server.listening),
  };
  return service;
};

module.exports = { createChat2ApiProxyService };
