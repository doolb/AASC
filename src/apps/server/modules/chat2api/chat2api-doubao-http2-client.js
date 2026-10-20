const http2 = require('node:http2');
const zlib = require('node:zlib');
const { DOUBAO_REQUEST_ORIGIN, DOUBAO_REQUEST_PATH } = require('./chat2api-doubao-request-profile');

const omittedHeaders = new Set(['host', 'connection', 'proxy-connection', 'transfer-encoding', 'upgrade', 'keep-alive']);

/**
 * 官网样本使用 HTTP/2；该客户端只允许固定豆包聊天地址。请求头由已校验账号模板提供，
 * Cookie 由适配器在发送前覆盖。返回值维持 Axios 流接口，供现有 SSE 解析器继续消费。
 */
const createDoubaoHttp2Client = () => ({
  request: async config => {
    let url;
    try { url = new URL(config.url); } catch { throw new Error('doubao_invalid_provider'); }
    if (url.origin !== DOUBAO_REQUEST_ORIGIN || url.pathname !== DOUBAO_REQUEST_PATH
      || config.method !== 'POST') throw new Error('doubao_invalid_provider');
    const body = JSON.stringify(config.data);
    const headers = { ':method': 'POST', ':scheme': 'https', ':authority': url.host,
      ':path': url.pathname + url.search };
    for (const [rawName, value] of Object.entries(config.headers || {})) {
      const name = rawName.toLowerCase();
      if (name.startsWith(':') || omittedHeaders.has(name)) continue;
      headers[name] = String(value);
    }
    headers['content-length'] = String(Buffer.byteLength(body));
    const client = http2.connect(DOUBAO_REQUEST_ORIGIN);
    let request;
    let abortHandler;
    client.on('error', error => { if (request && !request.destroyed) request.destroy(error); });
    const stop = () => {
      config.signal?.removeEventListener('abort', abortHandler);
      if (!client.closed && !client.destroyed) client.close();
    };
    try {
      if (config.signal?.aborted) throw Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });
      request = client.request(headers);
      abortHandler = () => { request.close(http2.constants.NGHTTP2_CANCEL); client.destroy(); };
      config.signal?.addEventListener('abort', abortHandler, { once: true });
      request.on('end', stop);
      request.on('close', stop);
      request.end(body);
      const responseHeaders = await new Promise((resolve, reject) => {
        request.once('response', resolve);
        request.once('error', reject);
        client.once('error', reject);
      });
      const encoding = String(responseHeaders['content-encoding'] || '').toLowerCase();
      let data = request;
      if (encoding === 'gzip') data = request.pipe(zlib.createGunzip());
      if (encoding === 'deflate') data = request.pipe(zlib.createInflate());
      if (encoding === 'br') data = request.pipe(zlib.createBrotliDecompress());
      if (encoding === 'zstd' && typeof zlib.createZstdDecompress === 'function') {
        data = request.pipe(zlib.createZstdDecompress());
      }
      return { status: Number(responseHeaders[':status']), headers: responseHeaders, data,
        request: { res: { responseUrl: config.url } } };
    } catch (error) {
      if (request && !request.closed) request.close(http2.constants.NGHTTP2_CANCEL);
      client.destroy();
      throw error;
    }
  },
});

module.exports = { createDoubaoHttp2Client };
