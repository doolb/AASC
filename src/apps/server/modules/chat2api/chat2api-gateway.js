const http = require('http');

const ALLOWED_PATH_PREFIXES = Object.freeze(['/api/chat2api/', '/v1/', '/health', '/stats']);

const sendJson = (response, statusCode, payload) => {
  const content = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(content));
  response.end(content);
};

const isAllowedPath = (pathname) => ALLOWED_PATH_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix));

const createChat2ApiGateway = ({ taskManager, getTaskManager, requestTimeout = 30_000 } = {}) => {
  const resolveTaskManager = () => getTaskManager ? getTaskManager() : taskManager;
  if (!getTaskManager && (!taskManager || typeof taskManager.getInstanceStatus !== 'function')) {
    throw new Error('Chat2API 同源网关需要任务管理器');
  }

  return async (request, response, next) => {
    const instanceId = request.params && request.params.instanceId;
    const manager = resolveTaskManager();
    if (!manager || typeof manager.getInstanceStatus !== 'function') {
      sendJson(response, 503, { error: { message: '任务管理器尚未初始化', code: 'task_manager_unavailable' } });
      return;
    }
    let instance;
    try {
      instance = await manager.getInstanceStatus('chat2api.proxy', instanceId);
    } catch (error) {
      sendJson(response, 503, { error: { message: `读取 Chat2API 任务状态失败: ${error.message}`, code: 'chat2api_status_unavailable' } });
      return;
    }
    if (!instance || instance.status !== 'running' || !instance.params) {
      sendJson(response, 409, { error: { message: 'Chat2API 代理任务未运行', code: 'chat2api_not_running' } });
      return;
    }

    const port = Number(instance.params.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      sendJson(response, 502, { error: { message: 'Chat2API 代理端口无效', code: 'chat2api_invalid_port' } });
      return;
    }
    const upstreamPath = request.url || '/';
    const pathname = upstreamPath.split('?')[0];
    if (!isAllowedPath(pathname)) {
      if (typeof next === 'function') {
        next();
        return;
      }
      sendJson(response, 404, { error: { message: 'Chat2API 网关路径不存在', code: 'not_found' } });
      return;
    }

    const body = request.body === undefined || request.body === null
      ? null
      : Buffer.isBuffer(request.body) ? request.body : Buffer.from(JSON.stringify(request.body), 'utf8');
    const headers = { ...request.headers, host: `127.0.0.1:${port}`, connection: 'close' };
    delete headers['content-length'];
    delete headers['transfer-encoding'];
    if (body) {
      headers['content-type'] = headers['content-type'] || 'application/json';
      headers['content-length'] = body.length;
    }

    const upstream = http.request({
      host: '127.0.0.1',
      port,
      method: request.method,
      path: upstreamPath,
      headers,
      timeout: requestTimeout,
    }, (upstreamResponse) => {
      response.statusCode = upstreamResponse.statusCode || 502;
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (value !== undefined && name !== 'connection') response.setHeader(name, value);
      }
      upstreamResponse.pipe(response);
    });

    const fail = (error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      sendJson(response, 502, { error: { message: `Chat2API 代理转发失败: ${error.message}`, code: 'chat2api_gateway_error' } });
    };
    upstream.on('timeout', () => upstream.destroy(new Error('Chat2API 代理请求超时')));
    upstream.on('error', fail);
    response.on('close', () => {
      if (!upstream.destroyed) upstream.destroy();
    });
    if (body) upstream.write(body);
    upstream.end();
  };
};

module.exports = { createChat2ApiGateway };
