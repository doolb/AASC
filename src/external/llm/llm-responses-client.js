'use strict';

const http = require('node:http');
const https = require('node:https');

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

const createResponsesError = (statusCode, code, message, body = null) => {
  const error = new Error(message || `Responses 请求失败: HTTP ${statusCode}`);
  error.statusCode = statusCode;
  error.code = code || 'responses_request_failed';
  if (body && typeof body === 'object') error.response = body;
  return error;
};

const normalizeBaseUrl = (baseUrl) => String(baseUrl || '').replace(/\/+$/u, '');

const parseJsonBody = (body, statusCode) => {
  try {
    return body ? JSON.parse(body) : {};
  } catch (error) {
    throw createResponsesError(statusCode, 'invalid_response', 'Responses 返回内容不是有效 JSON');
  }
};

const getRemoteError = (payload, statusCode) => {
  const errorPayload = payload && payload.error;
  const message = errorPayload?.message || `Responses 请求失败: HTTP ${statusCode}`;
  const code = errorPayload?.code || (statusCode >= 500 ? 'upstream_error' : 'invalid_request_error');
  return createResponsesError(statusCode, code, message, payload);
};

const readResponseBody = (response, maxBytes = MAX_RESPONSE_BYTES) => new Promise((resolve, reject) => {
  let totalBytes = 0;
  const chunks = [];
  response.on('data', (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      response.destroy(new Error('Responses 响应超过大小限制'));
      return;
    }
    chunks.push(chunk);
  });
  response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  response.on('error', reject);
});

const requestJson = ({ url, options, timeoutMs }) => new Promise((resolve, reject) => {
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === 'https:' ? https : http;
  const request = transport.request({
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: `${parsedUrl.pathname}${parsedUrl.search}`,
    method: options.method || 'POST',
    headers: options.headers || {}
  }, async (response) => {
    try {
      const body = await readResponseBody(response);
      resolve({ statusCode: response.statusCode || 0, headers: response.headers, body });
    } catch (error) {
      reject(error);
    }
  });
  request.once('error', reject);
  request.setTimeout(timeoutMs, () => request.destroy(new Error('Responses 请求超时')));
  if (options.body) request.write(options.body);
  request.end();
});

const streamSse = ({ url, options, timeoutMs, onEvent }) => new Promise((resolve, reject) => {
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === 'https:' ? https : http;
  const request = transport.request({
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: `${parsedUrl.pathname}${parsedUrl.search}`,
    method: options.method || 'POST',
    headers: options.headers || {}
  }, (response) => {
    let buffer = '';
    let dataLines = [];
    let totalBytes = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const emitData = () => {
      if (dataLines.length === 0 || settled) {
        dataLines = [];
        return;
      }
      const data = dataLines.join('\n');
      dataLines = [];
      if (data === '[DONE]') {
        settled = true;
        resolve();
        return;
      }
      try {
        const event = JSON.parse(data);
        onEvent(event);
        if (event.type === 'response.failed') {
          fail(getRemoteError(event, response.statusCode || 500));
        }
      } catch (error) {
        fail(error.code ? error : createResponsesError(response.statusCode || 200, 'invalid_response', 'Responses SSE 事件不是有效 JSON'));
      }
    };

    const consumeLines = (text) => {
      buffer += text;
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line === '') {
          emitData();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    };

    response.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        response.destroy(new Error('Responses SSE 响应超过大小限制'));
        return;
      }
      consumeLines(chunk.toString('utf8'));
    });
    response.on('end', () => {
      if (buffer.trim()) consumeLines('\n');
      emitData();
      if (!settled) {
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
          fail(createResponsesError(response.statusCode, 'responses_request_failed', 'Responses 流式请求失败'));
          return;
        }
        settled = true;
        resolve();
      }
    });
    response.on('error', fail);
    if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
      // 先继续收集错误体，结束时统一转换为 Responses 错误；这里不向回调投递错误 JSON。
      let errorBody = '';
      response.on('data', (chunk) => { errorBody += chunk.toString('utf8'); });
      response.on('end', () => {
        let payload = null;
        try { payload = JSON.parse(errorBody); } catch (error) { /* 使用状态码兜底 */ }
        fail(getRemoteError(payload, response.statusCode || 500));
      });
    }
  });
  request.once('error', reject);
  request.setTimeout(timeoutMs, () => request.destroy(new Error('Responses 流式请求超时')));
  if (options.body) request.write(options.body);
  request.end();
});

const createResponsesClient = ({ baseUrl, apiKey = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) throw new Error('Responses 客户端缺少 baseUrl');

  const buildRequestOptions = (body, options = {}) => {
    const payload = JSON.stringify(body || {});
    const headers = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      ...(options.headers || {})
    };
    const requestApiKey = options.apiKey === undefined ? apiKey : options.apiKey;
    if (requestApiKey) headers.Authorization = `Bearer ${requestApiKey}`;
    return { method: 'POST', headers, body: payload };
  };

  const request = async (body, options = {}) => {
    const result = await requestJson({
      url: `${normalizedBaseUrl}/responses`,
      options: buildRequestOptions(body, options),
      timeoutMs: options.timeoutMs || timeoutMs
    });
    const payload = parseJsonBody(result.body, result.statusCode);
    if (result.statusCode < 200 || result.statusCode >= 300) throw getRemoteError(payload, result.statusCode);
    if (payload.error) throw getRemoteError(payload, result.statusCode);
    return payload;
  };

  const stream = async (body, onEvent, options = {}) => {
    if (typeof onEvent !== 'function') throw new Error('Responses stream 需要事件回调');
    return streamSse({
      url: `${normalizedBaseUrl}/responses`,
      options: buildRequestOptions(body, options),
      timeoutMs: options.timeoutMs || timeoutMs,
      onEvent
    });
  };

  return { request, stream, baseUrl: normalizedBaseUrl };
};

module.exports = {
  DEFAULT_TIMEOUT_MS,
  createResponsesClient,
  normalizeBaseUrl
};
