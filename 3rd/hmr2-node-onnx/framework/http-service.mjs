import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat, lstat } from 'node:fs/promises';
import { ServiceError, publicError } from '../core/errors.mjs';
import { parseInferRequest, serializeFiniteJson } from '../core/protocol.mjs';

const MIB = 1024 * 1024;
const NONCE_MARKER = '__HMR_NONCE__';
const PRECHECK_METHODS = new Map([['/health', 'GET'], ['/infer', 'POST']]);
const REJECT_METHODS = new Set(['HEAD', 'PUT', 'DELETE', 'PATCH', 'TRACE', 'CONNECT']);

function requireOption(condition, message) {
  if (!condition) throw new TypeError(message);
}
function positiveInteger(value) { return Number.isSafeInteger(value) && value > 0; }
function loopback(host) {
  if (host.toLowerCase() === 'localhost') return true;
  const address = host.replace(/^\[|\]$/g, '');
  if (isIP(address) === 4) return address.split('.')[0] === '127';
  if (isIP(address) !== 6) return false;
  try { return new URL(`http://[${address}]`).hostname === '[::1]'; } catch { return false; }
}
function explicitOrigin(value) {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#]+$/i.test(value)
      || /[\s*@\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

/** 由 CLI 复用同一配置检查；真正 listen 时必须使用已验证的 host，而非另选公网地址。 */
export function validateHttpOptions(options = {}) {
  requireOption(options !== null && typeof options === 'object' && !Array.isArray(options), 'HTTP options 必须是对象');
  const result = {
    host: options.host ?? '127.0.0.1',
    apiToken: options.apiToken ?? '',
    corsOrigins: options.corsOrigins ?? [],
    maxRequestBytes: options.maxRequestBytes ?? 24 * MIB,
    maxImageBytes: options.maxImageBytes ?? 16 * MIB,
    maxPixels: options.maxPixels ?? 40_000_000,
    socketReadTimeoutMs: options.socketReadTimeoutMs ?? 15_000,
  };
  for (const key of Object.keys(result)) {
    if (options[key] !== undefined) result[key] = options[key];
  }
  requireOption(typeof result.host === 'string' && Boolean(result.host), 'host 必须是非空字符串');
  requireOption(typeof result.apiToken === 'string', 'apiToken 必须是字符串');
  requireOption(loopback(result.host) || Boolean(result.apiToken), '非 loopback 监听必须提供非空 apiToken');
  requireOption(Array.isArray(result.corsOrigins) && result.corsOrigins.every(explicitOrigin), 'CORS 必须是明确的 HTTP(S) Origin，不允许通配符或路径');
  for (const key of ['maxRequestBytes', 'maxImageBytes', 'maxPixels', 'socketReadTimeoutMs']) {
    requireOption(positiveInteger(result[key]), `${key} 必须是正整数`);
  }
  result.corsOrigins = Object.freeze([...new Set(result.corsOrigins)]);
  return Object.freeze(result);
}

function headers(req, name) {
  const values = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index].toLowerCase() === name) values.push(req.rawHeaders[index + 1]);
  }
  return values;
}
function header(req, name) { return headers(req, name)[0] ?? ''; }
function errorDto(error) { return { error: { status: error.status, code: error.code, message: error.message } }; }
function authenticate(req, token) {
  if (!token) return;
  const values = headers(req, 'authorization');
  const supplied = values.length === 1 && values[0].startsWith('Bearer ') ? values[0].slice(7) : '';
  const actual = Buffer.from(supplied, 'utf8');
  const expected = Buffer.from(token, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ServiceError(401, 'unauthorized', '缺少或无效的 Bearer token');
  }
}

/** 只处理已通过 Node 原生 HTTP parser 的请求；重复 CL、TE+CL 在 clientError 单独拒绝。 */
async function readBody(req, options) {
  const parts = header(req, 'content-type').split(';').map((part) => part.trim().toLowerCase());
  if (parts[0] !== 'application/json' || parts.length > 2
      || (parts.length === 2 && parts[1] !== 'charset=utf-8')) {
    throw new ServiceError(415, 'unsupported_media_type', '必须使用 application/json');
  }
  if (header(req, 'transfer-encoding')) throw new ServiceError(400, 'invalid_request', '不支持 Transfer-Encoding');
  const lengths = headers(req, 'content-length');
  if (!lengths.length) throw new ServiceError(411, 'length_required', '必须提供 Content-Length');
  if (lengths.length !== 1 || !/^[0-9]+$/.test(lengths[0])) {
    throw new ServiceError(400, 'invalid_request', 'Content-Length 无效');
  }
  if (lengths[0].length > 10 || Number(lengths[0]) > options.maxRequestBytes) {
    throw new ServiceError(413, 'request_too_large', '请求大小超过限制');
  }
  const expected = Number(lengths[0]);
  if (!expected) throw new ServiceError(400, 'invalid_json', 'JSON 请求不能为空');
  let size = 0;
  const chunks = [];
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > expected || size > options.maxRequestBytes) throw new ServiceError(413, 'request_too_large', '请求大小超过限制');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(400, 'invalid_request', 'HTTP 请求体不完整');
  } finally {
    // 原 Python 的 15s 限制是读 socket；已经完整读取后的 ONNX 推理不受此定时器限制。
    req.socket.setTimeout(0);
  }
  if (size !== expected) throw new ServiceError(400, 'invalid_request', 'HTTP 请求体不完整');
  return Buffer.concat(chunks, size);
}

async function fixedAsset(path, page) {
  const code = page ? 'test_page_unavailable' : 'three_module_unavailable';
  const message = page ? '本地测试页面不可用' : '本地三维组件不可用';
  try {
    if (typeof path !== 'string' || !path) throw new TypeError('缺少固定资源');
    const metadata = page ? await stat(path) : await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MIB || (!page && !metadata.size)) throw new TypeError('资源尺寸无效');
    const bytes = await readFile(path);
    if (bytes.length > MIB || (!page && !bytes.length)) throw new TypeError('资源尺寸变化');
    return bytes;
  } catch {
    throw new ServiceError(503, code, message);
  }
}

/**
 * 只创建未 listen 的 node:http.Server；不导入 ORT、不读取模型或探测 GPU。
 * 仅固定页面资源在对应 GET 时异步读取，engine 使用鸭子类型方便 CPU 假引擎自测。
 */
export function createService({ engine, options = {}, assets = {} } = {}) {
  requireOption(engine && typeof engine.health === 'function' && typeof engine.predictBytes === 'function', 'engine 必须提供 health/predictBytes');
  requireOption(assets !== null && typeof assets === 'object' && !Array.isArray(assets), 'assets 必须是对象');
  const configuration = validateHttpOptions(options);
  const allowedOrigins = new Set(configuration.corsOrigins);
  const { testPagePath, threeModulePath } = assets;

  function respond(req, res, status, value, preflight = false) {
    let bytes = Buffer.alloc(0);
    if (value !== undefined) {
      try { bytes = serializeFiniteJson(value); }
      catch {
        status = 500;
        bytes = serializeFiniteJson(errorDto(new ServiceError(500, 'serialization_failed', '推理结果无法安全序列化')));
      }
    }
    const output = {
      'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin', Connection: 'close',
    };
    const origin = header(req, 'origin');
    if (allowedOrigins.has(origin)) {
      output['Access-Control-Allow-Origin'] = origin;
      if (preflight) Object.assign(output, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600',
      });
    }
    res.writeHead(status, output);
    res.end(bytes);
  }
  function respondAsset(res, bytes, extraHeaders) {
    res.writeHead(200, {
      'Content-Length': bytes.length, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', Connection: 'close', ...extraHeaders,
    });
    res.end(bytes);
  }
  async function testPage(res) {
    const bytes = await fixedAsset(testPagePath, true);
    let template;
    try { template = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new ServiceError(503, 'test_page_unavailable', '本地测试页面不可用'); }
    if (template.split(NONCE_MARKER).length !== 2) throw new ServiceError(503, 'test_page_unavailable', '本地测试页面不可用');
    const nonce = randomBytes(24).toString('base64url');
    const rendered = Buffer.from(template.replace(NONCE_MARKER, nonce), 'utf8');
    respondAsset(res, rendered, {
      'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}' 'self'; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`,
    });
  }
  async function get(req, res) {
    if (req.url === '/') { await testPage(res); return; }
    if (req.url === '/hmr2-three.js') {
      respondAsset(res, await fixedAsset(threeModulePath, false), {
        'Content-Type': 'text/javascript; charset=utf-8', 'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer',
      });
      return;
    }
    authenticate(req, configuration.apiToken);
    if (req.url !== '/health') throw new ServiceError(404, 'not_found', '路由不存在');
    respond(req, res, 200, await engine.health());
  }
  async function post(req, res) {
    authenticate(req, configuration.apiToken);
    if (req.url !== '/infer') throw new ServiceError(404, 'not_found', '路由不存在');
    const bytes = await readBody(req, configuration);
    const { imageBytes, bbox } = parseInferRequest(bytes, configuration.maxImageBytes);
    respond(req, res, 200, await engine.predictBytes(imageBytes, bbox));
  }
  async function preflight(req, res) {
    if (!allowedOrigins.has(header(req, 'origin'))) throw new ServiceError(403, 'cors_denied', 'Origin 不在 CORS 白名单');
    const method = PRECHECK_METHODS.get(req.url);
    if (!method) throw new ServiceError(404, 'not_found', '路由不存在');
    if (header(req, 'access-control-request-method') !== method) throw new ServiceError(405, 'method_not_allowed', '预检方法与路由不匹配');
    const names = header(req, 'access-control-request-headers').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
    if (names.some((name) => !['authorization', 'content-type'].includes(name))) throw new ServiceError(403, 'cors_denied', '预检请求头不在白名单');
    respond(req, res, 204, undefined, true);
  }
  const routes = new Map([['GET', get], ['POST', post], ['OPTIONS', preflight]]);
  function dispatch(req, res) {
    res.on('error', () => { req.socket.destroy(); });
    req.socket.setTimeout(req.method === 'POST' ? configuration.socketReadTimeoutMs : 0);
    // 异步 handler 的每条失败路径集中转换安全错误，避免未捕获 Promise rejection。
    void (async () => {
      try {
        const route = routes.get(req.method);
        if (!route) {
          const status = REJECT_METHODS.has(req.method) ? 405 : 501;
          throw new ServiceError(status, 'method_not_allowed', '仅支持 GET /health、POST /infer 和 CORS OPTIONS');
        }
        await route(req, res);
      } catch (error) {
        req.socket.setTimeout(0);
        if (!res.headersSent && !res.destroyed && !req.socket.destroyed) {
          const safe = publicError(error);
          respond(req, res, safe.status, errorDto(safe));
        }
      }
    })();
  }
  const server = createServer({ requestTimeout: 0, headersTimeout: 0, keepAliveTimeout: 0, requireHostHeader: false }, dispatch);
  server.on('connection', (socket) => {
    socket.setTimeout(configuration.socketReadTimeoutMs);
    socket.on('timeout', () => { socket.destroy(); }); // 只关闭本 Server 所拥有的连接。
  });
  server.on('clientError', (error, socket) => {
    // 原生 parser 在进入 handler 前拒绝重复 CL/TE+CL/坏报文；统一安全 JSON，绝不回显 rawPacket。
    if (!socket.writable || socket.writableEnded || socket.destroyed) return;
    const bytes = serializeFiniteJson(errorDto(new ServiceError(400, 'invalid_request', 'HTTP 请求解析无效或请求体不完整')));
    socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${bytes.length}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nVary: Origin\r\nConnection: close\r\n\r\n${bytes.toString('utf8')}`);
  });
  // Node 将 CONNECT/Upgrade 分派为特殊事件；复用 HTTP 响应，而非授予隧道或 WebSocket。
  // 原 Python 不因 GET 的 Upgrade 头改变路由，因此不能把 GET /health 擅自改成405。
  function ordinaryHttp(incoming, socket, head) {
    // 原 IncomingMessage 已被 parser push(null)，复用它会 ERR_STREAM_PUSH_AFTER_EOF。
    const req = new IncomingMessage(socket);
    for (const key of ['method', 'url', 'rawHeaders', 'headers', 'httpVersion', 'httpVersionMajor', 'httpVersionMinor']) req[key] = incoming[key];
    const res = new ServerResponse(req);
    res.assignSocket(socket);
    res.once('finish', () => { socket.end(); });
    if (req.method === 'POST') {
      const length = header(req, 'content-length');
      let remaining = /^[0-9]+$/.test(length) ? Number(length) : 0;
      function finish() {
        socket.off('data', consume);
        socket.off('end', finish);
        // 特殊事件的 parser 已移交；长度仍由 readBody 验证，但不让流销毁误断正常响应。
        req.complete = true;
        req.push(null);
      }
      function consume(bytes) {
        const count = Math.min(bytes.length, remaining);
        if (count) req.push(bytes.subarray(0, count));
        remaining -= count;
        if (!remaining) finish();
      }
      socket.on('data', consume);
      socket.once('end', finish);
      res.once('finish', () => { socket.off('data', consume); socket.off('end', finish); });
      if (head?.length) consume(head);
      if (!remaining && !req.readableEnded) finish();
    }
    dispatch(req, res);
  }
  server.on('connect', ordinaryHttp);
  server.on('upgrade', ordinaryHttp);
  return server;
}
