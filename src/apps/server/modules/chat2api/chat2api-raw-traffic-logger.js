const { Readable, Transform } = require('stream');
const zlib = require('zlib');

const DEFAULT_MAX_BYTES = 256 * 1024;
const MIN_MAX_BYTES = 1024;
const MAX_MAX_BYTES = 2 * 1024 * 1024;
const RAW_TRAFFIC_MODES = Object.freeze(['full', 'compact']);
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|secret|password|api[-_]?key|signature|signed|ticket|credential|refresh|access|pow)/i;

const normalizeMaxBytes = (value, fallback = DEFAULT_MAX_BYTES) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_MAX_BYTES || parsed > MAX_MAX_BYTES) {
    return fallback;
  }
  return parsed;
};

const normalizeRawTrafficMode = (value, fallback = 'full') => RAW_TRAFFIC_MODES.includes(value) ? value : fallback;

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

const toText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => toText(item)).filter(Boolean).join('');
  if (typeof value !== 'object') return '';
  const preferred = ['text', 'content', 'output_text', 'answer', 'value'];
  for (const key of preferred) {
    if (value[key] !== undefined) {
      const text = toText(value[key]);
      if (text) return text;
    }
  }
  return '';
};

const parseBodyValue = (value) => {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    try { return JSON.parse(Buffer.from(value).toString('utf8')); } catch { return Buffer.from(value).toString('utf8'); }
  }
  return value;
};

const extractModel = (value) => {
  const body = parseBodyValue(value);
  return body && typeof body === 'object' && typeof body.model === 'string' ? body.model : '';
};

const extractRequestText = (value) => {
  const body = parseBodyValue(value);
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return '';
  if (Array.isArray(body.messages)) {
    return body.messages.map((message) => toText(message && (message.content ?? message.text ?? message))).filter(Boolean).join('\n');
  }
  for (const key of ['input', 'prompt', 'query', 'text', 'content']) {
    const text = toText(body[key]);
    if (text) return text;
  }
  return '';
};

const extractResponseText = (value) => {
  const body = parseBodyValue(value);
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return '';
  if (typeof body.output_text === 'string') return body.output_text;
  if (Array.isArray(body.choices)) {
    const text = body.choices.map((choice) => toText(choice && (choice.message ?? choice.delta ?? choice.text ?? choice))).filter(Boolean).join('');
    if (text) return text;
  }
  if (Array.isArray(body.output)) {
    const text = toText(body.output);
    if (text) return text;
  }
  if (Array.isArray(body.messages)) {
    const text = body.messages.map((message) => toText(message && (message.content ?? message.text ?? message))).filter(Boolean).join('');
    if (text) return text;
  }
  for (const key of ['answer', 'content', 'text', 'message']) {
    const text = toText(body[key]);
    if (text) return text;
  }
  if (body.data && body.data !== body) return extractResponseText(body.data);
  return '';
};

const extractDeltaText = (value) => {
  const body = parseBodyValue(value);
  if (!body || typeof body !== 'object' || !Array.isArray(body.choices)) return null;
  const text = body.choices.map((choice) => toText(choice && choice.delta)).filter(Boolean).join('');
  return text || null;
};

const getHeader = (headers, name) => {
  if (!headers || typeof headers !== 'object') return '';
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1] || '').toLowerCase() : '';
};

const decodeStreamBody = (chunks, headers) => {
  let buffer = Buffer.concat(chunks);
  const encoding = getHeader(headers, 'content-encoding');
  try {
    if (encoding.includes('gzip')) buffer = zlib.gunzipSync(buffer);
    if (encoding.includes('deflate')) buffer = zlib.inflateSync(buffer);
    if (encoding.includes('br')) buffer = zlib.brotliDecompressSync(buffer);
  } catch {
    // 压缩数据不完整时保留空输出，不能影响原始流透传。
    return '';
  }
  const text = buffer.toString('utf8');
  const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter((line) => line && line !== '[DONE]');
  if (!dataLines.length) return text;
  const parsed = dataLines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  const deltas = parsed.map((item) => extractDeltaText(item)).filter(Boolean);
  if (deltas.length) return deltas.join('');
  const outputs = parsed.map((item) => extractResponseText(item)).filter(Boolean);
  return outputs.reduce((longest, output) => output.length > longest.length ? output : longest, '');
};

const createRawTrafficLogger = ({ sink = (record) => console.log(`[Chat2API][raw] ${JSON.stringify(record)}`) } = {}) => {
  const createHttpClient = ({ httpClient, providerId, context = {}, enabled = false, maxBytes = DEFAULT_MAX_BYTES, mode = 'full' }) => {
    if (!httpClient || typeof httpClient.request !== 'function') {
      throw new Error('原始流量日志需要有效的 HTTP client');
    }
    if (!enabled) {
      return { request: (requestConfig) => httpClient.request(requestConfig) };
    }

    const limit = normalizeMaxBytes(maxBytes);
    const trafficMode = normalizeRawTrafficMode(mode);
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
      const compact = trafficMode === 'compact';
      let responseHeaders = {};
      if (compact) {
        emit('request', {
          model: extractModel(requestConfig.data) || context.model || '',
          text: extractRequestText(requestConfig.data),
        });
      } else {
        emit('request', {
          method: requestConfig.method || 'GET',
          url: sanitizeUrl(requestConfig.url),
          headers: sanitizeValue(requestConfig.headers || {}),
          params: sanitizeValue(requestConfig.params),
          data: sanitizeValue(requestConfig.data),
          responseType: requestConfig.responseType,
        });
      }
      return {
        response: (response) => {
          responseHeaders = response && response.headers || {};
          if (!compact) emit('response', { status: response && response.status, headers: sanitizeValue(responseHeaders) }, undefined, false);
        },
        body: (body) => compact ? emit('response', { output: extractResponseText(body) }) : emit('response_body', body),
        chunk: (chunk) => emit('response_chunk', { type: 'chunk', value: sanitizeValue(chunk) }),
        error: (error) => emit('error', compact ? { message: error && error.message } : { message: error && error.message, status: error && error.response && error.response.status }, undefined, false),
        wrapStream: (data) => {
          if (!data || typeof data[Symbol.asyncIterator] !== 'function') return data;
          const source = typeof data.pipe === 'function' ? data : Readable.from(data);
          const compactChunks = [];
          let compactBytes = 0;
          const wrapped = new Transform({
            transform(chunk, encoding, callback) {
              if (compact) {
                const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
                const available = Math.max(0, limit - compactBytes);
                if (available > 0) {
                  compactChunks.push(chunkBuffer.subarray(0, available));
                  compactBytes += Math.min(chunkBuffer.length, available);
                }
              } else {
                emit('response_chunk', { type: 'chunk', value: sanitizeValue(chunk) });
              }
              callback(null, chunk);
            },
            flush(callback) {
              if (compact) emit('response', { output: decodeStreamBody(compactChunks, responseHeaders) });
              callback();
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
  RAW_TRAFFIC_MODES,
  normalizeMaxBytes,
  normalizeRawTrafficMode,
  sanitizeValue,
  sanitizeUrl,
  createRawTrafficLogger,
};
