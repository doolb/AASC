const jsonBody = (value) => {
  if (value === undefined || value === '') return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { throw Object.assign(new Error('request body must be valid JSON'), { statusCode: 400 }); }
};

const pathParts = (value) => String(value ?? '/').split('?')[0].split('/').filter(Boolean).map((part) => decodeURIComponent(part));

const matchPath = (pattern, actual) => {
  const expected = pathParts(pattern);
  const received = pathParts(actual);
  if (expected.length !== received.length) return undefined;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].startsWith(':')) params[expected[index].slice(1)] = received[index];
    else if (expected[index] !== received[index]) return undefined;
  }
  return params;
};

const statusForError = (error) => error?.statusCode ?? (error?.code === 'revision-conflict' || error?.code === 'NAVMESH_REVISION_CONFLICT' ? 409 : 400);

/** Small dependency-free HTTP router used by the API and tests. */
export class HttpRouter {
  constructor(options = {}) {
    this.routes = [];
    this.authorize = options.authorize;
  }

  register(method, pattern, handler) {
    if (typeof handler !== 'function') throw new Error('route handler is required');
    this.routes.push({ method: String(method).toUpperCase(), pattern, handler });
    return this;
  }

  get(pattern, handler) { return this.register('GET', pattern, handler); }
  post(pattern, handler) { return this.register('POST', pattern, handler); }
  put(pattern, handler) { return this.register('PUT', pattern, handler); }
  delete(pattern, handler) { return this.register('DELETE', pattern, handler); }

  async dispatch(request, rawBody) {
    if (this.authorize && !(await this.authorize(request))) return { status: 401, body: { error: 'unauthorized' } };
    const route = this.routes.find((candidate) => candidate.method === String(request.method ?? 'GET').toUpperCase() && matchPath(candidate.pattern, request.url));
    if (!route) return { status: 404, body: { error: 'not-found' } };
    try {
      const body = String(request.method ?? 'GET').toUpperCase() === 'GET' ? {} : jsonBody(rawBody);
      const result = await route.handler(request, matchPath(route.pattern, request.url), body);
      return { status: result?.status ?? 200, headers: result?.headers, body: result?.body ?? result };
    } catch (error) {
      return { status: statusForError(error), body: { error: error.message, code: error.code } };
    }
  }

  async handle(request, response) {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const result = await this.dispatch(request, Buffer.concat(chunks).toString('utf8'));
    const payload = Buffer.from(JSON.stringify(result.body ?? {}));
    response.statusCode = result.status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('content-length', payload.length);
    for (const [key, value] of Object.entries(result.headers ?? {})) response.setHeader(key, value);
    response.end(payload);
    return result;
  }
}
