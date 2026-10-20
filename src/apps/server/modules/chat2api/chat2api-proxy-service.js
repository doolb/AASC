const http = require('http');
const multer = require('multer');
const { validateWav } = require('../../../../external/tts/tts-wav');

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
  const speechService = options.speechService;
  const doubaoMediaService = options.doubaoMediaService;
  const doubaoFileService = options.doubaoFileService;
  let server = null;
  const sockets = new Set();
  const statistics = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
  };

  const sendJson = (response, statusCode, payload, { noStore = false } = {}) => {
    const body = JSON.stringify(payload);
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (noStore) response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Length', Buffer.byteLength(body));
    response.end(body);
  };

  const sendJsonAttachment = (response, payload, filename, { noStore = false } = {}) => {
    const body = `${JSON.stringify(payload, null, 2)}\n`;
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (noStore) response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Length', Buffer.byteLength(body));
    response.end(body);
  };

  const normalizePublicError = (error) => {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const code = error.code || 'internal_error';
    const message = statusCode >= 500 && !error.code ? 'Chat2API 代理内部错误' : error.message;
    return { statusCode, error: { message, type: statusCode >= 500 ? 'api_error' : 'invalid_request_error', code } };
  };

  const sendError = (response, error) => {
    const normalized = normalizePublicError(error);
    sendJson(response, normalized.statusCode, { error: normalized.error });
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

  /** 兼容参考接口的 multipart 上传；文件只驻留本次请求内存并受独立体积上限约束。 */
  const readMultipartFile = async (request, response, maxBytes) => {
    const parser = multer({ storage: multer.memoryStorage(), limits: {
      fileSize: maxBytes, files: 1, fields: 8, parts: 9,
    } }).fields([{ name: 'file', maxCount: 1 }, { name: 'image', maxCount: 1 }]);
    await new Promise((resolve, reject) => parser(request, response, error => error ? reject(error) : resolve()));
    const file = request.files?.file?.[0] || request.files?.image?.[0];
    if (!file?.buffer?.length || !file.originalname) throw Object.assign(new Error('缺少上传文件'),
      { statusCode: 400, code: 'missing_file' });
    return { filename: file.originalname, data: file.buffer, fields: request.body || {} };
  };

  const readUploadFile = async (request, response, { maxBytes, kind }) => {
    if (/^multipart\/form-data(?:;|$)/iu.test(request.headers['content-type'] || '')) {
      try { return await readMultipartFile(request, response, maxBytes); }
      catch (error) {
        if (error?.code === 'LIMIT_FILE_SIZE') throw Object.assign(new Error('上传文件过大'),
          { statusCode: 413, code: `${kind}_limit` });
        throw error;
      }
    }
    const payload = await readJson(request);
    if (typeof payload.data_base64 !== 'string' || payload.data_base64.length > Math.ceil(maxBytes * 4 / 3) + 4
      || !/^[A-Za-z0-9+/]+={0,2}$/u.test(payload.data_base64)) {
      throw Object.assign(new Error('上传数据不是有效 Base64'), { statusCode: 400, code: `${kind}_input` });
    }
    const data = Buffer.from(payload.data_base64, 'base64');
    if (data.length === 0 || data.length > maxBytes) throw Object.assign(new Error('上传文件过大'),
      { statusCode: 413, code: `${kind}_limit` });
    return { filename: payload.filename, data };
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

  /**
   * 必须在请求体读取结束后绑定当前响应：正常 request.close 表示上传结束，不是客户端断连。
   * 只监听 response.close 且 writableEnded 尚未成立的分支，避免正常完成后误取消或影响别的账号。
   */
  const withResponseCancellation = async (response, operation) => {
    const controller = new AbortController();
    const onClose = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', onClose);
    if (response.destroyed && !response.writableEnded) controller.abort();
    try {
      return await operation(controller.signal);
    } finally {
      response.removeListener('close', onClose);
    }
  };

  const writeStream = async (response, stream) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    for await (const chunk of stream) {
      // for-await 的 break 会调用流迭代器 return，配合 close signal 立即释放上游。
      if (response.destroyed || response.writableEnded) {
        break;
      }
      const data = typeof chunk === 'string' && chunk.startsWith('data:') ? chunk : JSON.stringify(chunk);
      response.write(`data: ${data}\n\n`);
    }
    if (!response.destroyed && !response.writableEnded) {
      response.end('data: [DONE]\n\n');
    }
  };

  const writeResponsesStream = async (response, stream) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    try {
      for await (const event of stream) {
        if (response.destroyed || response.writableEnded) break;
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      if (!response.destroyed && !response.writableEnded) response.end('data: [DONE]\n\n');
    } catch (error) {
      // 首个事件写出后 HTTP 状态已固定；用 SSE 失败事件交还真实错误，避免销毁连接只剩 socket hang up。
      if (response.destroyed || response.writableEnded) return;
      if (!response.headersSent) throw error;
      const normalized = normalizePublicError(error);
      console.warn(`[Chat2API] Responses 流失败: stage=after_headers code=${normalized.error.code} status=${normalized.statusCode}`);
      response.end(`data: ${JSON.stringify({ type: 'response.failed', error: { ...normalized.error, statusCode: normalized.statusCode } })}\n\n`);
    }
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
      sendJson(response, 200, { name: 'AASC Chat2API Proxy', endpoints: ['/v1/chat/completions', '/v1/responses', '/v1/completions', '/v1/models', '/v1/audio/speech', '/v1/audio/voices',
        ...(doubaoMediaService ? ['/v1/images/generations', '/v1/images/edits', '/v1/images/upload',
          '/v1/audio/generations', '/v1/video/generations'] : []),
        ...(doubaoFileService ? ['/v1/files', '/v1/files/download', '/v1/chat/completions/with-file'] : [])] });
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
      if (request.method === 'GET' && url.pathname === '/api/chat2api/export') {
        sendJsonAttachment(response, await managementService.exportConfig(), 'chat2api-config.json');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/chat2api/accounts/export') {
        sendJsonAttachment(response, await managementService.exportAccountCredentials(), 'chat2api-accounts.json', { noStore: true });
        return;
      }
      const body = ['POST', 'PUT'].includes(request.method) ? await readJson(request) : null;
      const managementResult = await (async () => {
        if (request.method === 'GET' && url.pathname === '/api/chat2api/config') return managementService.getConfig();
        if (request.method === 'PUT' && url.pathname === '/api/chat2api/config') return managementService.saveConfig(body);
        if (request.method === 'GET' && url.pathname === '/api/chat2api/providers') return managementService.listProviders();
        if (['POST', 'PUT'].includes(request.method) && url.pathname === '/api/chat2api/providers') return managementService.saveProvider(body);
        if (request.method === 'DELETE' && url.pathname.startsWith('/api/chat2api/providers/')) return managementService.deleteProvider(decodeURIComponent(url.pathname.split('/').pop()));
        if (request.method === 'GET' && url.pathname === '/api/chat2api/accounts') return managementService.listAccounts();
        if (request.method === 'POST' && url.pathname === '/api/chat2api/accounts/manual') return managementService.addManualAccount(body);
        if (request.method === 'POST' && url.pathname === '/api/chat2api/accounts/import/preview') return managementService.previewAccountImport(body);
        if (request.method === 'POST' && url.pathname === '/api/chat2api/accounts/import/merge') return managementService.mergeAccountImport(body && body.data, body && body.confirmation, body && body.confirmed);
        if (request.method === 'POST' && url.pathname === '/api/chat2api/accounts/web-session/consume') return managementService.consumeAccountWebSession(body && body.sessionId);
        if (request.method === 'POST' && url.pathname === '/api/chat2api/accounts/web-session/refresh') return managementService.refreshAccountWebSession(body && body.refreshToken, body && body.cookieSnapshot, body && body.requestProfile);
        if (request.method === 'POST' && url.pathname.endsWith('/web-session') && url.pathname.startsWith('/api/chat2api/accounts/')) {
          const prefix = '/api/chat2api/accounts/';
          const suffix = '/web-session';
          const accountId = decodeURIComponent(url.pathname.slice(prefix.length, -suffix.length));
          return managementService.createAccountWebSession(accountId);
        }
        if (request.method === 'POST' && url.pathname.startsWith('/api/chat2api/accounts/') && url.pathname.endsWith('/verify')) {
          const accountId = url.pathname.slice('/api/chat2api/accounts/'.length, -'/verify'.length);
          if (!accountId || accountId.includes('/')) throw Object.assign(new Error('账号验证路径无效'), { statusCode: 400 });
          return managementService.verifyAccount(decodeURIComponent(accountId));
        }
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
        if (request.method === 'POST' && url.pathname === '/api/chat2api/qwen/web-import') return managementService.importQwenWebConversations(body || {});
        const error = new Error(`管理路由不存在: ${request.method} ${url.pathname}`);
        error.statusCode = 404;
        error.code = 'not_found';
        throw error;
      })();
      sendJson(response, 200, await managementResult, {
        noStore: ['/api/chat2api/accounts/web-session/consume', '/api/chat2api/accounts/web-session/refresh'].includes(url.pathname) || url.pathname.endsWith('/verify'),
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      const result=await coreAdapter.listModels();
      const speechModels=await speechService?.listModels?.()||[];
      sendJson(response,200,{...result,data:[...new Map([...result.data,...speechModels].map(model=>[model.id,model])).values()]});
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/audio/voices') {
      if (!speechService?.voices) throw Object.assign(new Error('Chat2API语音目录不可用'), { statusCode: 503, code: 'speech_unavailable' });
      const models = url.searchParams.getAll('model');
      if (models.length !== 1 || !models[0].trim()) throw Object.assign(new Error('必须提供唯一的语音model'), { statusCode: 400, code: 'invalid_speech_request' });
      sendJson(response, 200, { object: 'list', model: models[0], data: await speechService.voices(models[0]) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/files/download') {
      if (!doubaoFileService) throw Object.assign(new Error('豆包网页文件任务未启动'),
        { statusCode: 503, code: 'doubao_file_unavailable' });
      const uri = url.searchParams.get('uri');
      const expire = Number(url.searchParams.get('expire') || 3600);
      await withResponseCancellation(response, async signal => {
        const result = await doubaoFileService.downloadUrl(uri, expire, { signal });
        if (!response.destroyed && !response.writableEnded) sendJson(response, 200, result, { noStore: true });
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/files') {
      if (!doubaoFileService) throw Object.assign(new Error('豆包网页文件任务未启动'),
        { statusCode: 503, code: 'doubao_file_unavailable' });
      const file = await readUploadFile(request, response, { maxBytes: 20 * 1024 * 1024, kind: 'doubao_file' });
      await withResponseCancellation(response, async signal => {
        const result = await doubaoFileService.upload(file, { signal });
        if (!response.destroyed && !response.writableEnded) sendJson(response, 200, {
          id: result.uri, object: 'file', filename: result.name, bytes: result.size,
          uri: result.uri, file_type: result.file_type, purpose: 'assistants',
        }, { noStore: true });
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/chat/completions/with-file') {
      if (!doubaoFileService?.chatWithFile) throw Object.assign(new Error('豆包网页文件问答不可用'),
        { statusCode: 503, code: 'doubao_file_unavailable' });
      const payload = await readJson(request);
      await withResponseCancellation(response, async signal => {
        const result = await doubaoFileService.chatWithFile({ fileId: payload.file_id,
          prompt: payload.prompt, fileName: payload.file_name, fileSize: payload.file_size,
          model: payload.model }, { signal });
        if (!response.destroyed && !response.writableEnded) sendJson(response, 200, {
          id: result.id, object: 'chat.completion', created: Math.floor(Date.now() / 1000),
          model: payload.model || 'doubao', choices: [{ index: 0, message: { role: 'assistant',
            content: result.text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          conversation_id: result.conversationId,
        });
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/images/upload') {
      if (!doubaoMediaService?.uploadImage) throw Object.assign(new Error('豆包网页图片上传不可用'),
        { statusCode: 503, code: 'doubao_image_unavailable' });
      const file = await readUploadFile(request, response, { maxBytes: 10 * 1024 * 1024, kind: 'doubao_image' });
      await withResponseCancellation(response, async signal => {
        const result = await doubaoMediaService.uploadImage(file, { signal });
        if (!response.destroyed && !response.writableEnded) sendJson(response, 200, result);
      });
      return;
    }
    const mediaKind = {
      '/v1/images/generations': 'image', '/v1/images/edits': 'image',
      '/v1/audio/generations': 'music', '/v1/video/generations': 'video',
    }[url.pathname];
    if (request.method === 'POST' && mediaKind) {
      if (!doubaoMediaService) throw Object.assign(new Error('豆包网页媒体任务未启动'),
        { statusCode: 503, code: 'doubao_media_unavailable' });
      const multipart = /^multipart\/form-data(?:;|$)/iu.test(request.headers['content-type'] || '');
      const mediaPayload = multipart ? await readMultipartFile(request, response, 10 * 1024 * 1024)
        .then(file => ({ ...file.fields, image_data_base64: file.data.toString('base64'),
          image_filename: file.filename,
          ...(file.fields.memory_type !== undefined ? { memory_type: Number(file.fields.memory_type) } : {}),
          ...(file.fields.save_history !== undefined ? { save_history: String(file.fields.save_history).toLowerCase() === 'true' } : {}),
        })) : await readJson(request);
      await withResponseCancellation(response, async signal => {
        const referenceKeys = mediaPayload.ref_image_keys || mediaPayload.ref_image_key || [];
        const uploaded = [];
        if (mediaPayload.image_data_base64 && ['image', 'video'].includes(mediaKind)) {
          if (typeof mediaPayload.image_data_base64 !== 'string'
            || mediaPayload.image_data_base64.length > 15 * 1024 * 1024
            || !/^[A-Za-z0-9+/]+={0,2}$/u.test(mediaPayload.image_data_base64)) {
            throw Object.assign(new Error('参考图片数据无效'), { statusCode: 400, code: 'doubao_image_input' });
          }
          uploaded.push((await doubaoMediaService.uploadImage({ filename: mediaPayload.image_filename || 'image.png',
            data: Buffer.from(mediaPayload.image_data_base64, 'base64') }, { signal })).uri);
        }
        const result = await doubaoMediaService.generate(mediaKind, {
          prompt: mediaPayload.prompt, ratio: mediaPayload.ratio, lyric: mediaPayload.lyric, genre: mediaPayload.genre,
          memoryType: mediaPayload.memory_type, saveHistory: mediaPayload.save_history,
          refImageKeys: [...(Array.isArray(referenceKeys) ? referenceKeys : [referenceKeys]), ...uploaded] }, { signal });
        const data = mediaKind === 'image' ? result.images : mediaKind === 'music' ? result.tracks : result.videos;
        if (!data?.length) throw Object.assign(new Error('豆包网页未返回有效媒体'),
          { statusCode: 502, code: 'doubao_media_empty' });
        if (!response.destroyed && !response.writableEnded) sendJson(response, 200,
          { created: Math.floor(Date.now() / 1000), data });
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/audio/speech') {
      if (!speechService) throw Object.assign(new Error('Chat2API 语音服务不可用'), { statusCode: 503, code: 'speech_unavailable' });
      const payload = await readJson(request);
      await withResponseCancellation(response, async (signal) => {
        const result = await speechService.generate(payload, { signal });
        validateWav(result.audio);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'audio/wav');
        response.setHeader('Content-Length', result.audio.length);
        response.setHeader('Cache-Control', 'no-store');
        response.end(result.audio);
      });
      return;
    }
    if (request.method === 'POST' && ['/v1/chat/completions', '/v1/completions'].includes(url.pathname)) {
      const payload = await readJson(request);
      const chatRequest = url.pathname === '/v1/completions'
        ? { ...payload, messages: [{ role: 'user', content: payload.prompt || '' }] }
        : payload;
      await withResponseCancellation(response, async (signal) => {
        const result = await coreAdapter.forwardChatCompletion(chatRequest, { signal });
        if (result.stream) {
          await writeStream(response, result.stream);
          return;
        }
        if (!response.destroyed && !response.writableEnded) sendJson(response, 200, result.body);
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/responses') {
      if (!responsesService || typeof responsesService.createResponse !== 'function') {
        const error = new Error('Responses 兼容服务不可用');
        error.statusCode = 503;
        error.code = 'responses_unavailable';
        throw error;
      }
      const payload = await readJson(request);
      await withResponseCancellation(response, async (signal) => {
        const result = await responsesService.createResponse(payload, { signal });
        if (result.stream) {
          await writeResponsesStream(response, result.stream);
          return;
        }
        if (!response.destroyed && !response.writableEnded) sendJson(response, 200, result.body);
      });
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
        if (response.destroyed || response.writableEnded) return;
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
