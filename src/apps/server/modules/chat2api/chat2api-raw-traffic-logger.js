const { Readable, Transform } = require('stream');

const DEFAULT_MAX_BYTES = 256 * 1024;
const MIN_MAX_BYTES = 1024;
const MAX_MAX_BYTES = 2 * 1024 * 1024;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|secret|password|api[-_]?key|signature|signed|ticket|credential|refresh|access|pow)/i;

const normalizeMaxBytes = (value, fallback = DEFAULT_MAX_BYTES) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_MAX_BYTES || parsed > MAX_MAX_BYTES) {
    return fallback;
  }
  return parsed;
};

const isSensitiveKey = (key) => SENSITIVE_KEY_PATTERN.test(String(key || ''));

const sanitizeUrl = (value) => {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    for (const [key] of url.searchParams) {
      if (isSensitiveKey(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return value;
  }
};

const sanitizeValue = (value, seen = new WeakSet()) => {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buffer = Buffer.from(value);
    const text = buffer.toString('utf8');
    try {
      return sanitizeValue(JSON.parse(text));
    } catch {
      return { type: 'binary', encoding: 'base64', value: buffer.toString('base64') };
    }
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, seen));
  if (value instanceof URL) return sanitizeUrl(value.toString());
  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? '[REDACTED]' : key === 'url' ? sanitizeUrl(item) : sanitizeValue(item, seen);
    }
    return result;
  }
  return String(value);
};

const serialize = (value) => {
  const sanitized = sanitizeValue(value);
  if (typeof sanitized === 'string') return sanitized;
  try {
    return JSON.stringify(sanitized);
  } catch {
    return '[Unserializable]';
  }
};

const truncateUtf8 = (value, maxBytes) => {
  const buffer = Buffer.from(String(value), 'utf8');
  if (buffer.length <= maxBytes) return { value: buffer.toString('utf8'), truncated: false, bytes: buffer.length };
  return { value: buffer.subarray(0, Math.max(0, maxBytes)).toString('utf8'), truncated: true, bytes: maxBytes };
};

const createRawTrafficLogger = ({ sink = (record) => console.log(`[Chat2API][raw] ${JSON.stringify(record)}`) } = {}) => {
  const createHttpClient = ({ httpClient, providerId, context = {}, enabled = false, maxBytes = DEFAULT_MAX_BYTES }) => {
    if (!httpClient || typeof httpClient.request !== 'function') {
      throw new Error('原始流量日志需要有效的 HTTP client');
    }
    if (!enabled) {
      return { request: (requestConfig) => httpClient.request(requestConfig) };
    }

    const limit = normalizeMaxBytes(maxBytes);
    let sequence = 0;
    let rawTrafficBytes = 0;
    let truncationEmitted = false;
    const emit = (event, payload, rawPayload = payload, consumesBudget = true) => {
      const rawText = serialize(rawPayload);
      if (consumesBudget && rawTrafficBytes >= limit && truncationEmitted) return;
      const available = consumesBudget ? Math.max(0, limit - rawTrafficBytes) : rawText.length;
      const clipped = consumesBudget ? truncateUtf8(rawText, available) : { value: rawText, truncated: false, bytes: 0 };
      if (consumesBudget) rawTrafficBytes += clipped.bytes;
      if (consumesBudget && clipped.truncated) truncationEmitted = true;
      const record = {
        timestamp: new Date().toISOString(),
        event,
        requestId: context.requestId || null,
        providerId,
        sequence: sequence += 1,
        data: clipped.truncated ? clipped.value : sanitizeValue(payload),
        truncated: clipped.truncated,
      };
      try {
        sink(record);
      } catch {
        // 日志输出失败不能影响 Provider 请求。
      }
    };

    const createTrace = (requestConfig) => {
      emit('request', {
        method: requestConfig.method || 'GET',
        url: sanitizeUrl(requestConfig.url),
        headers: sanitizeValue(requestConfig.headers || {}),
        params: sanitizeValue(requestConfig.params),
        data: sanitizeValue(requestConfig.data),
        responseType: requestConfig.responseType,
      });
      return {
        response: (response) => emit('response', { status: response && response.status, headers: sanitizeValue(response && response.headers || {}) }, undefined, false),
        body: (body) => emit('response_body', body),
        chunk: (chunk) => emit('response_chunk', { type: 'chunk', value: sanitizeValue(chunk) }),
        error: (error) => emit('error', { message: error && error.message, status: error && error.response && error.response.status }, undefined, false),
        wrapStream: (data) => {
          if (!data || typeof data[Symbol.asyncIterator] !== 'function') return data;
          const source = typeof data.pipe === 'function' ? data : Readable.from(data);
          const wrapped = new Transform({
            transform(chunk, encoding, callback) {
              emit('response_chunk', { type: 'chunk', value: sanitizeValue(chunk) });
              callback(null, chunk);
            },
          });
          source.once('error', (error) => {
            emit('error', { message: error && error.message });
            wrapped.destroy(error);
          });
          source.pipe(wrapped);
          return wrapped;
        },
      };
    };

    return {
      request: async (requestConfig) => {
        const trace = createTrace(requestConfig || {});
        try {
          const response = await httpClient.request(requestConfig);
          trace.response(response);
          if (response && response.data && typeof response.data[Symbol.asyncIterator] === 'function') {
            response.data = trace.wrapStream(response.data);
          } else if (response) {
            trace.body(response.data);
          }
          return response;
        } catch (error) {
          trace.error(error);
          throw error;
        }
      },
    };
  };

  return { createHttpClient };
};

module.exports = {
  DEFAULT_MAX_BYTES,
  MIN_MAX_BYTES,
  MAX_MAX_BYTES,
  normalizeMaxBytes,
  sanitizeValue,
  sanitizeUrl,
  createRawTrafficLogger,
};
