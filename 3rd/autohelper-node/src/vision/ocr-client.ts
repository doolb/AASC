import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { OcrBox, OcrClientLike, OcrResult, Point } from '../types.js';

const DEFAULT_OCR_URL = 'https://127.0.0.1:8081';
const DEFAULT_TIMEOUT_MS = 30_000;
const OCR_ROUTE = '/api/vision/ocr';

export type OcrHttpResponse = {
  statusCode: number;
  body: string;
};

export type OcrRequestOptions = {
  timeoutMs: number;
  rejectUnauthorized: boolean;
};

export type OcrRequest = (
  url: string,
  body: string,
  options: OcrRequestOptions,
) => Promise<OcrHttpResponse>;

export type OcrClientOptions = {
  baseUrl?: string;
  shortSide?: number;
  timeoutMs?: number;
  rejectUnauthorized?: boolean;
  request?: OcrRequest;
};

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

const parsePositiveInteger = (value: number, field: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
};

const parseShortSide = (value: number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value !== 0 && (!Number.isInteger(value) || value < 256 || value > 2048)) {
    throw new Error('OCR shortSide must be 0 or an integer from 256 to 2048');
  }
  return value;
};

const resolveTimeoutMs = (value: number | undefined): number => {
  if (value !== undefined) {
    return parsePositiveInteger(value, 'OCR timeout');
  }
  const seconds = Number(process.env.AASC_TIMEOUT_SECONDS);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_TIMEOUT_MS;
};

const resolveBaseUrl = (value: string | undefined): string => {
  const candidate = value?.trim() || process.env.AASC_URL?.trim() || DEFAULT_OCR_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch (error: unknown) {
    throw new Error(`invalid OCR URL: ${candidate}`, { cause: error });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`unsupported OCR URL protocol: ${url.protocol}`);
  }
  return new URL(OCR_ROUTE, url).toString();
};

const readResponse = (response: IncomingMessage): Promise<OcrHttpResponse> => (
  new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    response.once('error', reject);
    response.once('end', () => {
      resolvePromise({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      });
    });
  })
);

const finishRequest = (
  clientRequest: ClientRequest,
  body: string,
  options: OcrRequestOptions,
  resolvePromise: (response: OcrHttpResponse) => void,
  reject: (error: Error) => void,
): void => {
  clientRequest.once('error', reject);
  clientRequest.setTimeout(options.timeoutMs, () => {
    clientRequest.destroy(new Error(`OCR request timed out after ${options.timeoutMs} ms`));
  });
  clientRequest.once('response', (response) => {
    readResponse(response).then(resolvePromise).catch(reject);
  });
  clientRequest.end(body);
};

const requestJson: OcrRequest = async (urlString, body, options) => {
  const url = new URL(urlString);
  const requestOptions = {
    hostname: url.hostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: 'POST' as const,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    timeout: options.timeoutMs,
  };

  return new Promise<OcrHttpResponse>((resolvePromise, rejectPromise) => {
    const reject = (error: Error): void => rejectPromise(error);
    if (url.protocol === 'https:') {
      const clientRequest = httpsRequest({
        ...requestOptions,
        rejectUnauthorized: options.rejectUnauthorized,
      });
      finishRequest(clientRequest, body, options, resolvePromise, reject);
      return;
    }

    const clientRequest = httpRequest(requestOptions);
    finishRequest(clientRequest, body, options, resolvePromise, reject);
  });
};

const parsePoint = (value: unknown): Point | null => {
  if (Array.isArray(value) && value.length === 2
    && typeof value[0] === 'number' && typeof value[1] === 'number'
    && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    return { x: value[0], y: value[1] };
  }
  if (isJsonObject(value)
    && typeof value.x === 'number' && typeof value.y === 'number'
    && Number.isFinite(value.x) && Number.isFinite(value.y)) {
    return { x: value.x, y: value.y };
  }
  return null;
};

const parseBox = (value: unknown): OcrBox | null => {
  if (!isJsonObject(value) || typeof value.text !== 'string') {
    return null;
  }
  const points = Array.isArray(value.points)
    ? value.points.map(parsePoint).filter((point): point is Point => point !== null)
    : [];
  const score = typeof value.score === 'number' && Number.isFinite(value.score)
    ? value.score
    : undefined;
  return { text: value.text, score, points };
};

const parseOptionalSize = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
);

const responseError = (payload: unknown, statusCode: number): string => {
  if (isJsonObject(payload) && typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  return `OCR API returned HTTP ${statusCode}`;
};

export class OcrClient implements OcrClientLike {
  private readonly url: string;
  private readonly shortSide?: number;
  private readonly timeoutMs: number;
  private readonly rejectUnauthorized: boolean;
  private readonly request: OcrRequest;

  public constructor(options: OcrClientOptions = {}) {
    this.url = resolveBaseUrl(options.baseUrl);
    this.shortSide = parseShortSide(options.shortSide);
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs);
    this.rejectUnauthorized = options.rejectUnauthorized ?? process.env.AASC_INSECURE === '0';
    this.request = options.request ?? requestJson;
  }

  public async recognize(frame: Buffer): Promise<OcrResult> {
    const requestBody: JsonObject = { imageBase64: frame.toString('base64') };
    if (this.shortSide !== undefined) {
      requestBody.shortSide = this.shortSide;
    }

    let response: OcrHttpResponse;
    try {
      response = await this.request(this.url, JSON.stringify(requestBody), {
        timeoutMs: this.timeoutMs,
        rejectUnauthorized: this.rejectUnauthorized,
      });
    } catch (error: unknown) {
      throw new Error(`OCR request failed: ${errorMessage(error)}`, { cause: error });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(response.body) as unknown;
    } catch (error: unknown) {
      throw new Error(`OCR API returned invalid JSON: ${errorMessage(error)}`, { cause: error });
    }

    if (response.statusCode < 200 || response.statusCode >= 300
      || (isJsonObject(payload) && payload.status === 'error')) {
      throw new Error(responseError(payload, response.statusCode));
    }
    if (!isJsonObject(payload)) {
      throw new Error('OCR API response must be a JSON object');
    }

    const boxes = Array.isArray(payload.boxes)
      ? payload.boxes.map(parseBox).filter((box): box is OcrBox => box !== null)
      : [];
    return {
      boxes,
      imageWidth: parseOptionalSize(payload.imageWidth),
      imageHeight: parseOptionalSize(payload.imageHeight),
    };
  }
}
