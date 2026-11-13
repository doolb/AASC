import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const DEFAULT_OCR_URL = 'https://127.0.0.1:8081';
const DEFAULT_TIMEOUT_MS = 30_000;
const OCR_ROUTE = '/api/vision/ocr';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

const positiveInteger = (value, field) => {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
  return value;
};

const shortSide = (value) => {
  if (value === undefined) return undefined;
  if (value !== 0 && (!Number.isInteger(value) || value < 256 || value > 2048)) {
    throw new Error('OCR shortSide must be 0 or an integer from 256 to 2048');
  }
  return value;
};

const baseUrl = (value) => {
  const candidate = value?.trim() || process.env.AASC_URL?.trim() || DEFAULT_OCR_URL;
  let url;
  try { url = new URL(candidate); } catch (error) { throw new Error(`invalid OCR URL: ${candidate}`, { cause: error }); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`unsupported OCR URL protocol: ${url.protocol}`);
  return new URL(OCR_ROUTE, url).toString();
};

const readResponse = (response) => new Promise((resolve, reject) => {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  response.once('error', reject);
  response.once('end', () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
});

const requestJson = async (urlString, body, options) => {
  const url = new URL(urlString);
  const requestOptions = {
    hostname: url.hostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    timeout: options.timeoutMs,
  };
  return await new Promise((resolve, reject) => {
    const client = url.protocol === 'https:'
      ? httpsRequest({ ...requestOptions, rejectUnauthorized: options.rejectUnauthorized })
      : httpRequest(requestOptions);
    client.once('error', reject);
    client.setTimeout(options.timeoutMs, () => client.destroy(new Error(`OCR request timed out after ${options.timeoutMs} ms`)));
    client.once('response', (response) => readResponse(response).then(resolve).catch(reject));
    client.end(body);
  });
};

const point = (value) => {
  if (Array.isArray(value) && value.length === 2 && value.every((item) => Number.isFinite(item))) {
    return { x: value[0], y: value[1] };
  }
  if (isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y)) return { x: value.x, y: value.y };
  return null;
};

const parseBox = (value) => {
  if (!isObject(value) || typeof value.text !== 'string') return null;
  return {
    text: value.text,
    ...(Number.isFinite(value.score) ? { score: value.score } : {}),
    points: Array.isArray(value.points) ? value.points.map(point).filter(Boolean) : [],
  };
};

const parseSize = (value) => (Number.isInteger(value) && value > 0 ? value : undefined);

export class OcrClient {
  constructor(options = {}) {
    this.url = baseUrl(options.baseUrl);
    this.shortSide = shortSide(options.shortSide);
    this.timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : positiveInteger(options.timeoutMs, 'OCR timeout');
    this.rejectUnauthorized = options.rejectUnauthorized ?? process.env.AASC_INSECURE === '0';
    this.request = options.request ?? requestJson;
  }

  async read(imageBuffer, options = {}) {
    if (!Buffer.isBuffer(imageBuffer) && !(imageBuffer instanceof Uint8Array)) {
      throw new Error('OCR image must be a Buffer or Uint8Array');
    }
    const configuredShortSide = options.shortSide === undefined ? this.shortSide : shortSide(options.shortSide);
    const requestBody = { imageBase64: Buffer.from(imageBuffer).toString('base64') };
    if (configuredShortSide !== undefined) requestBody.shortSide = configuredShortSide;
    let response;
    try {
      response = await this.request(this.url, JSON.stringify(requestBody), {
        timeoutMs: options.timeoutMs === undefined ? this.timeoutMs : positiveInteger(options.timeoutMs, 'OCR timeout'),
        rejectUnauthorized: options.rejectUnauthorized ?? this.rejectUnauthorized,
      });
    } catch (error) {
      throw new Error(`OCR request failed: ${errorMessage(error)}`, { cause: error });
    }
    let payload;
    try { payload = JSON.parse(response.body); } catch (error) {
      throw new Error(`OCR API returned invalid JSON: ${errorMessage(error)}`, { cause: error });
    }
    if (response.statusCode < 200 || response.statusCode >= 300 || (isObject(payload) && payload.status === 'error')) {
      const message = isObject(payload) && typeof payload.message === 'string' && payload.message.trim()
        ? payload.message.trim() : `OCR API returned HTTP ${response.statusCode}`;
      throw new Error(message);
    }
    if (!isObject(payload)) throw new Error('OCR API response must be a JSON object');
    return {
      boxes: Array.isArray(payload.boxes) ? payload.boxes.map(parseBox).filter(Boolean) : [],
      imageWidth: parseSize(payload.imageWidth),
      imageHeight: parseSize(payload.imageHeight),
    };
  }

  async recognize(imageBuffer, options) {
    return await this.read(imageBuffer, options);
  }
}
