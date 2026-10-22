import { ServiceError } from './errors.mjs';

const MIB = 1024 * 1024;
const DATA_IMAGE = /^data:image\/[A-Za-z0-9.+-]+;base64,/i;
const JSON_NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

function invalidJson() {
  return new ServiceError(400, 'invalid_json', 'JSON 编码或结构无效');
}

/** 严格解码且保留 BOM；原 Python 的字符串 JSON 输入不接受 UTF-8 BOM。 */
export function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw invalidJson();
  }
}

/**
 * 先完整扫描 JSON 语法及所有对象的键，再使用原生 JSON.parse 生成数据。
 * 不以正则猜测对象边界：嵌套对象、数组内对象和转义后相同的键都必须拒绝。
 * 数字遵循 JSON 语法；1e400 的范围留给 bbox 等业务验证，不冒充显式 Infinity。
 */
export function parseStrictJson(bytes) {
  const text = typeof bytes === 'string' ? bytes : decodeUtf8(bytes);
  let position = 0;
  function fail() { throw invalidJson(); }
  function whitespace() {
    while (position < text.length && /[\x20\t\r\n]/.test(text[position])) position += 1;
  }
  function string(decode = true) {
    const start = position;
    if (text[position++] !== '"') fail();
    while (position < text.length) {
      const character = text[position++];
      if (character === '"') return decode ? JSON.parse(text.slice(start, position)) : undefined;
      if (character.charCodeAt(0) < 32) fail();
      if (character !== '\\') continue;
      const escape = text[position++];
      if (escape === 'u') {
        if (!/^[0-9a-fA-F]{4}$/.test(text.slice(position, position + 4))) fail();
        position += 4;
        continue;
      }
      if (typeof escape !== 'string' || !'"\\/bfnrt'.includes(escape)) fail();
    }
    fail();
  }
  function collection(depth, object) {
    if (depth > 1000) fail(); // 与原服务的递归失败边界同类，不允许栈耗尽泄露异常。
    position += 1;
    whitespace();
    const close = object ? '}' : ']';
    const keys = object ? new Set() : null;
    if (text[position] === close) { position += 1; return; }
    while (position < text.length) {
      if (object) {
        if (text[position] !== '"') fail();
        const key = string();
        if (keys.has(key)) fail();
        keys.add(key);
        whitespace();
        if (text[position++] !== ':') fail();
        whitespace();
      }
      value(depth + 1);
      whitespace();
      const separator = text[position++];
      if (separator === close) return;
      if (separator !== ',') fail();
      whitespace();
    }
    fail();
  }
  function value(depth) {
    const character = text[position];
    if (character === '{') { collection(depth, true); return; }
    if (character === '[') { collection(depth, false); return; }
    if (character === '"') { string(false); return; }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, position)) { position += literal.length; return; }
    }
    JSON_NUMBER.lastIndex = position;
    const match = JSON_NUMBER.exec(text);
    if (!match) fail();
    position = JSON_NUMBER.lastIndex;
  }
  try {
    whitespace();
    value(0);
    whitespace();
    if (position !== text.length) fail();
    return JSON.parse(text);
  } catch {
    throw invalidJson();
  }
}

/**
 * 匹配原服务 Python 3.10 b64decode(validate=True)，而非 Node 的宽松解码。
 * 原实现允许最多两个多余末尾 '='，也不检查未使用 pad bits；不要做 canonical 回编码收紧。
 */
export function decodeInlineImage(value, maxBytes = 16 * MIB) {
  if (typeof value !== 'string') {
    throw new ServiceError(400, 'invalid_image', 'image_base64 必须是 base64 字符串');
  }
  if (value.length > 4 * Math.ceil(maxBytes / 3) + 96) {
    throw new ServiceError(413, 'image_too_large', '图片编码超过大小限制');
  }
  let encoded = value;
  if (/^data:/i.test(encoded)) {
    const prefix = DATA_IMAGE.exec(encoded);
    if (!prefix) throw new ServiceError(400, 'invalid_image', '仅接受 data:image/...;base64, 格式');
    encoded = encoded.slice(prefix[0].length);
  }
  const validAlphabet = /^[A-Za-z0-9+/]*={0,2}$/.test(encoded) && !/[^A-Za-z0-9+/=]/.test(encoded);
  const padding = encoded.endsWith('==') ? 2 : Number(encoded.endsWith('='));
  const remainder = (encoded.length - padding) % 4;
  if (!validAlphabet || remainder === 1 || (remainder === 2 && padding < 2)
      || (remainder === 3 && padding < 1)) {
    throw new ServiceError(400, 'invalid_image', '图片 base64 编码无效');
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length > maxBytes) throw new ServiceError(413, 'image_too_large', '解码后的图片超过大小限制');
  if (!decoded.length) throw new ServiceError(400, 'invalid_image', '图片不能为空');
  return decoded;
}

/** 保留先字段集合、再 base64、再显式 null 框的原 HTTP 错误优先级。 */
export function parseInferRequest(bytes, maxImageBytes = 16 * MIB) {
  const payload = parseStrictJson(bytes);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ServiceError(400, 'invalid_json', 'JSON 顶层必须是对象');
  }
  const keys = Object.keys(payload);
  if (!Object.hasOwn(payload, 'image_base64') || keys.some((key) => !['image_base64', 'bbox_xyxy'].includes(key))) {
    throw new ServiceError(400, 'invalid_request', 'JSON 仅接受 image_base64 和 bbox_xyxy');
  }
  const imageBytes = decodeInlineImage(payload.image_base64, maxImageBytes);
  if (Object.hasOwn(payload, 'bbox_xyxy') && payload.bbox_xyxy === null) {
    throw new ServiceError(400, 'invalid_bbox', 'bbox_xyxy 不允许 null；可直接省略');
  }
  return { imageBytes, bbox: payload.bbox_xyxy };
}

/** 供引擎在忙锁后、EXIF 定向尺寸已确定时验证；HTTP 不提前改变 busy 优先级。 */
export function validateBBox(value, width, height) {
  if (value === undefined) return { boxXYXY: [0, 0, width, height], bboxSource: 'full_image_fallback' };
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new ServiceError(400, 'invalid_bbox', 'bbox_xyxy 必须是四个有限数值');
  }
  const [x1, y1, x2, y2] = value;
  if (!(0 <= x1 && x1 < x2 && x2 <= width && 0 <= y1 && y1 < y2 && y2 <= height)) {
    throw new ServiceError(400, 'invalid_bbox', 'bbox_xyxy 超出定向后的图像或面积为零');
  }
  return { boxXYXY: [...value], bboxSource: 'supplied' };
}

/** 禁止非有限数字、非法成员或 toJSON 隐藏数据；UTF-8 输出不接受孤立代理字符。 */
export function serializeFiniteJson(value) {
  const ancestors = new Set();
  function text(value) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('非法 UTF-8 字符');
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError('非法 UTF-8 字符');
    }
  }
  function visit(item) {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError('非有限 JSON 数字');
    if (['undefined', 'bigint', 'function', 'symbol'].includes(typeof item)) throw new TypeError('不支持的 JSON 成员');
    if (typeof item === 'string') text(item);
    if (item === null || typeof item !== 'object') return;
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new TypeError('不支持的 JSON 对象');
    if (ancestors.has(item)) throw new TypeError('循环 JSON 对象');
    ancestors.add(item);
    if (Array.isArray(item)) {
      for (const member of item) visit(member);
    } else {
      for (const key of Object.keys(item)) { text(key); visit(item[key]); }
    }
    ancestors.delete(item);
  }
  visit(value);
  const encoded = JSON.stringify(value, (key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError('非有限 JSON 数字');
    if (['undefined', 'bigint', 'function', 'symbol'].includes(typeof item)) throw new TypeError('不支持的 JSON 成员');
    return item;
  });
  if (typeof encoded !== 'string') throw new TypeError('无法编码 JSON');
  return Buffer.from(encoded, 'utf8');
}
