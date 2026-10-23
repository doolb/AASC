'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');

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

const requestJson = ({ url, options, timeoutMs, requestOptions = {} }) => new Promise((resolve, reject) => {
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === 'https:' ? https : http;
  const request = transport.request({
    ...requestOptions,
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
  if (options.body?.pipe) {
    options.body.once('error', error => request.destroy(error));
    request.once('close', () => options.body.destroy());
    options.body.pipe(request); return;
  }
  if (options.body) request.write(options.body);
  request.end();
});

const streamSse = ({ url, options, timeoutMs, onEvent, requestOptions = {} }) => new Promise((resolve, reject) => {
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === 'https:' ? https : http;
  const request = transport.request({
    ...requestOptions,
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
    const statusCode = response.statusCode || 0;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const complete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const interrupted = () => createResponsesError(502, 'responses_stream_interrupted', 'Responses 流式连接提前结束');

    if (statusCode < 200 || statusCode >= 300) {
      // HTTP 错误不是 Responses 事件流：先完整读取 Chat2API JSON 错误，
      // 避免普通 SSE end 处理抢先把上游 code 覆盖成通用 responses_request_failed。
      let errorBody = '';
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error('Responses 错误响应超过大小限制'));
          return;
        }
        errorBody += chunk.toString('utf8');
      });
      response.on('end', () => {
        let payload = null;
        try {
          payload = errorBody ? JSON.parse(errorBody) : null;
        } catch (error) {
          payload = null;
        }
        fail(getRemoteError(payload, statusCode));
      });
      response.on('error', fail);
      return;
    }

    const emitData = () => {
      if (dataLines.length === 0 || settled) {
        dataLines = [];
        return;
      }
      const data = dataLines.join('\n');
      dataLines = [];
      if (data === '[DONE]') {
        complete();
        return;
      }
      try {
        const event = JSON.parse(data);
        onEvent(event);
        if (event.type === 'response.failed') {
          const remoteStatusCode = Number.isInteger(event.error?.statusCode) ? event.error.statusCode : response.statusCode || 500;
          fail(getRemoteError(event, remoteStatusCode));
        }
        if (event.type === 'response.completed') complete();
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
      if (!settled) fail(interrupted());
    });
    response.on('aborted', () => fail(interrupted()));
    response.on('close', () => fail(interrupted()));
    response.on('error', fail);
  });
  request.once('error', reject);
  request.setTimeout(timeoutMs, () => request.destroy(new Error('Responses 流式请求超时')));
  if (options.body) request.write(options.body);
  request.end();
});

const createResponsesClient = ({ baseUrl, apiKey = '', timeoutMs = DEFAULT_TIMEOUT_MS, requestOptions = {} } = {}) => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) throw new Error('Responses 客户端缺少 baseUrl');
  const baseRequestOptions = requestOptions && typeof requestOptions === 'object'
    ? { ...requestOptions }
    : {};

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
      timeoutMs: options.timeoutMs || timeoutMs,
      requestOptions: { ...baseRequestOptions, ...(options.requestOptions || {}) }
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
      requestOptions: { ...baseRequestOptions, ...(options.requestOptions || {}) },
      onEvent
    });
  };

  const uploadFile = async (file, options = {}) => {
    const size = file.path ? (await fs.promises.stat(file.path)).size : file.data?.length;
    if (!size || size > 100 * 1024 * 1024) throw createResponsesError(400, 'video_limit', '视频附件为空或超过100MiB');
    const boundary = `aasc-${randomUUID()}`;
    const filename = String(file.filename || file.name || 'video.mp4').replace(/[\r\n"\\]/g, '_');
    const mime = ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.mimeType) ? file.mimeType : 'application/octet-stream';
    const start = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
    const end = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Readable.from((async function* () { yield start; if (file.path) { for await (const part of fs.createReadStream(file.path)) yield part; } else yield file.data; yield end; })());
    const result = await requestJson({ url: `${normalizedBaseUrl}/chat/files`, timeoutMs: options.timeoutMs || timeoutMs,
      requestOptions: { ...baseRequestOptions, ...(options.requestOptions || {}), ...(options.signal ? { signal: options.signal } : {}) },
      options: { method: 'POST', body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': start.length + size + end.length,
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) } } });
    if ([404, 405].includes(result.statusCode)) throw createResponsesError(400, 'unsupported_modality', '当前LLM服务未提供视频文件上传接口，请切换支持视频的服务');
    const payload = parseJsonBody(result.body, result.statusCode);
    if (result.statusCode < 200 || result.statusCode >= 300 || !payload.id) throw getRemoteError(payload, result.statusCode);
    return payload;
  };
  return { request, stream, uploadFile, baseUrl: normalizedBaseUrl };
};

module.exports = {
  DEFAULT_TIMEOUT_MS,
  createResponsesClient,
  normalizeBaseUrl
};
