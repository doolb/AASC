// 网页 Cookie 快照只允许这两个固定来源；不会把认证子域的 Cookie 混进聊天请求。
const DOUBAO_COOKIE_ORIGINS = Object.freeze(['https://www.doubao.com', 'https://accounts.doubao.com']);
const COOKIE_NAME = /^[A-Za-z0-9_!#$%&'*+.^`|~-]{1,128}$/u;
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]{1,4096}$/u;
const CANONICAL_NAMES = new Set(['sessionid', 'passport_csrf_token', 'passport_csrf_token_default', 'msToken', 'ttwid', 's_v_web_id']);

const invalidSnapshot = () => Object.assign(new Error('豆包 Cookie 快照格式无效'), {
  statusCode: 422, code: 'doubao_invalid_credentials',
});

/** 逐段检查 Cookie 头；保留同名不同作用域的顺序，但限制数量和总容量。 */
const parseDoubaoCookieHeader = (value) => {
  if (typeof value !== 'string' || !value || value.length > 32 * 1024) throw invalidSnapshot();
  const segments = value.split(';');
  if (segments.length > 64) throw invalidSnapshot();
  return segments.map((segment) => {
    const part = segment.trim();
    const separator = part.indexOf('=');
    if (separator < 1) throw invalidSnapshot();
    const name = part.slice(0, separator);
    const cookieValue = part.slice(separator + 1);
    if (!COOKIE_NAME.test(name) || !COOKIE_VALUE.test(cookieValue)) throw invalidSnapshot();
    return { name, value: cookieValue };
  });
};

const normalizeDoubaoCookieSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || Object.keys(snapshot).length === 0
    || Object.keys(snapshot).some(origin => !DOUBAO_COOKIE_ORIGINS.includes(origin))) throw invalidSnapshot();
  const normalized = {};
  for (const origin of DOUBAO_COOKIE_ORIGINS) {
    if (!Object.hasOwn(snapshot, origin)) continue;
    normalized[origin] = parseDoubaoCookieHeader(snapshot[origin])
      .map(({ name, value }) => `${name}=${value}`).join('; ');
  }
  if (!normalized[DOUBAO_COOKIE_ORIGINS[0]]) throw invalidSnapshot();
  return normalized;
};

/** 初次捕获或刷新时，从 www 快照提取原有六类规范 Cookie，便于旧身份校验继续工作。 */
const canonicalDoubaoCookieFromSnapshot = (snapshot) => {
  const entries = parseDoubaoCookieHeader(snapshot[DOUBAO_COOKIE_ORIGINS[0]]);
  const selected = new Map();
  for (const { name, value } of entries) {
    if (CANONICAL_NAMES.has(name) && !selected.has(name)) selected.set(name, value);
  }
  return [...selected].map(([name, value]) => `${name}=${value}`).join('; ');
};

module.exports = { DOUBAO_COOKIE_ORIGINS, parseDoubaoCookieHeader, normalizeDoubaoCookieSnapshot, canonicalDoubaoCookieFromSnapshot };
