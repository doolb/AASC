import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createService, validateHttpOptions } from './http-service.mjs';
import { ServiceError } from '../core/errors.mjs';
import { NODE_SOURCE, BODY25_NAMES, BODY25_EDGES } from '../core/body25.mjs';
import { decodeInlineImage, parseStrictJson, parseInferRequest, validateBBox, serializeFiniteJson } from '../core/protocol.mjs';

const ORIGIN = 'http://allowed.example';
const TOKEN = 'session-secret';
const PAGE = '<!doctype html><script nonce="__HMR_NONCE__">console.log("local");</script>';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1cAAAAASUVORK5CYII=', 'base64');
const JSON_HEADERS = { 'Content-Type': 'application/json' };
function dto(box) {
  const bbox = validateBBox(box, 100, 80);
  return {
    type: 'hmr2.result', schemaVersion: 1, model: 'HMR2.0b', source: NODE_SOURCE,
    device: 'dml:0', gpu: { index: 0, name: 'fake device; not a GPU measurement' }, precision: 'fp32',
    imageSize: [100, 80], ...bbox, names: [...BODY25_NAMES], edges: BODY25_EDGES.map((edge) => [...edge]),
    xyz: Array.from({ length: 25 }, () => [0, 0, 0]), xy: Array.from({ length: 25 }, () => [50, 40]),
    rotations24: Array.from({ length: 24 }, () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]]), betas10: Array(10).fill(0),
    predCam: [1, 0, 0], cameraTranslation: [0, 0, 5], cameraDepth: Array(25).fill(5),
    projection: { focalLengthPx: 100, principalPointPx: [50, 40] },
    camera: { translation: [0, 0, 5], focalLengthPx: 100, principalPoint: [50, 40] },
    inputTensorSha256: '0'.repeat(64), modelLoadMs: 0, inferenceMs: 0,
    timingMs: { preprocess: 0, modelRun: 0, total: 0, modelLoad: 0 }, memory: { gpuAllocator: 'unknown' },
  };
}
function fakeEngine() {
  const calls = [];
  return {
    calls,
    healthCalls: 0,
    health() {
      this.healthCalls += 1;
      return { type: 'hmr2.health', model: 'HMR2.0b', ready: true, busy: false, device: 'dml:0',
        gpu: 0, precision: 'fp32', loadCount: 1, modelLoadMs: 0, memory: { gpuAllocator: 'unknown' } };
    },
    async predictBytes(bytes, box) {
      calls.push({ bytes: Buffer.from(bytes), box });
      return dto(box);
    },
  };
}
function payload(extra = {}) { return { image_base64: PNG.toString('base64'), ...extra }; }
function expectError(fn, status, code) {
  assert.throws(fn, (error) => error instanceof ServiceError && error.status === status && error.code === code);
}
async function request(port, { method = 'GET', path = '/health', headers = {}, body } = {}) {
  const bytes = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return await new Promise((resolveResult, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path,
      headers: { Connection: 'close', ...(bytes === undefined ? {} : { 'Content-Length': bytes.length }), ...headers }, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = text ? JSON.parse(text) : undefined; } catch { /* HTML 与固定 JS 不是 JSON。 */ }
        resolveResult({ status: res.statusCode, headers: res.headers, text, json });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(bytes);
  });
}
async function rawRequest(port, message, { finish = true } = {}) {
  return await new Promise((resolveResult, reject) => {
    const chunks = [];
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(2000, () => { socket.destroy(new Error('自有 raw socket 测试超时')); });
    socket.on('connect', () => { if (finish) socket.end(message); else socket.write(message); });
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const split = text.indexOf('\r\n\r\n');
      let json;
      try { json = JSON.parse(text.slice(split + 4)); } catch { /* 慢读超时允许仅关闭，不发送响应。 */ }
      resolveResult({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1]) || 0, text, json });
    });
  });
}
function rawHead(path, lines = [], method = 'POST') {
  return `${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n${lines.join('\r\n')}\r\n\r\n`;
}
async function withServer(work, { engine = fakeEngine(), options = {}, assets = {} } = {}) {
  const server = createService({ engine, options, assets });
  assert.equal(server.listening, false);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  assert.notEqual(port, 8768);
  assert.notEqual(port, 8769);
  try { await work({ port, engine, server }); }
  finally {
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}
async function withAssets(work) {
  const directory = await mkdtemp(join(tmpdir(), 'hmr2-http-test-'));
  const testPagePath = join(directory, 'page.html');
  const threeModulePath = join(directory, 'three.mjs');
  try {
    await writeFile(testPagePath, PAGE);
    await writeFile(threeModulePath, 'export const testModule = true;');
    await work({ testPagePath, threeModulePath, directory });
  } finally {
    // 只清理 mkdtemp 返回且仍位于 os.tmpdir 的本测试目录，不触碰用户资源。
    const absolute = resolve(directory);
    assert.equal(resolve(join(absolute, '..')), resolve(tmpdir()));
    assert.match(absolute.split(/[\\/]/).at(-1), /^hmr2-http-test-/);
    await rm(absolute, { recursive: true, force: true });
  }
}

// 全部 HTTP 证据来自 fake engine；绝不加载 ORT、真实模型、用户端口或 GPU。
test('构造真正未listen，不调用引擎或读取不存在的静态资源', () => {
  const engine = fakeEngine();
  const server = createService({ engine, assets: { testPagePath: 'missing', threeModulePath: 'missing' } });
  assert.equal(server.listening, false);
  assert.equal(server.address(), null);
  assert.equal(engine.healthCalls, 0);
  assert.equal(engine.calls.length, 0);
  assert.throws(() => createService({ engine: {} }), TypeError);
});

test('配置默认与公网鉴权/CORS/正整数规则，显式null不得隐藏', () => {
  assert.deepEqual(validateHttpOptions(), { host: '127.0.0.1', apiToken: '', corsOrigins: [],
    maxRequestBytes: 24 * 1024 * 1024, maxImageBytes: 16 * 1024 * 1024, maxPixels: 40_000_000, socketReadTimeoutMs: 15_000 });
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.2', '[::1]', '0:0:0:0:0:0:0:1']) assert.equal(validateHttpOptions({ host }).host, host);
  for (const host of ['0.0.0.0', '::', 'example.com', '127.1', '::ffff:127.0.0.1']) {
    assert.throws(() => validateHttpOptions({ host }), TypeError);
    assert.equal(validateHttpOptions({ host, apiToken: TOKEN }).apiToken, TOKEN);
  }
  for (const value of ['*', 'null', 'file://host', 'http://host/', 'http://a@host', 'http://host?x=1', 'http://host#x', 'http://host/a', 'http://host\n']) {
    assert.throws(() => validateHttpOptions({ corsOrigins: [value] }), TypeError);
  }
  for (const value of [null, false, 0, -1, 1.5, NaN, Infinity]) assert.throws(() => validateHttpOptions({ maxPixels: value }), TypeError);
  assert.throws(() => validateHttpOptions({ apiToken: null }), TypeError);
  assert.throws(() => validateHttpOptions({ host: null }), TypeError);
  assert.throws(() => validateHttpOptions({ corsOrigins: ORIGIN }), TypeError);
});

test('严格JSON拒所有层次/转义同名/坏UTF8/BOM/非法语法，但合法指数交业务校验', () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"items":[{"x":1,"x":2}]}',
    '{"a":{"b":{"c":1,"c":2}}}', '{"__proto__":1,"__proto__":2}', '{"x":NaN}', '{"x":Infinity}',
    '{"x":-Infinity}', '{"x":01}', '{"x":1.}', '{"x":1e}', '[1,]', '{"x":1,}', 'true false',
    '{"x":"\\q"}', '{"x":"\\u00xz"}', '{"x":"\n"}', '\uFEFF{}', '']) {
    expectError(() => parseStrictJson(text), 400, 'invalid_json');
  }
  expectError(() => parseStrictJson(Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x31, 0x7d])), 400, 'invalid_json');
  assert.deepEqual(parseStrictJson('{"a":[true,false,null,-2.5e2,"quote\\\"slash\\\\",{}]}'), { a: [true, false, null, -250, 'quote"slash\\', {}] });
  assert.equal(parseStrictJson('{"value":1e400}').value, Infinity);
  assert.equal(Object.getPrototypeOf(parseStrictJson('{"__proto__":{"polluted":true}}')), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test('base64逐项匹配原Python3.10 validate=True，保留非canonical末尾padding', () => {
  for (const text of ['YWJj', 'YWJj=', 'YWJj==']) assert.equal(decodeInlineImage(text).toString(), 'abc');
  for (const text of ['YWJ=', 'YWJ==']) assert.equal(decodeInlineImage(text).toString(), 'ab');
  assert.equal(decodeInlineImage('YR==').toString(), 'a'); // 原 Python 不验证未使用 pad bits。
  assert.equal(decodeInlineImage('DATA:IMAGE/png;BASE64,YWJj').toString(), 'abc');
  for (const text of ['', '====', 'YWJj====', 'YQ===', 'YQ=', 'YQ', 'Y', 'AA=A', 'AA==A', 'YWJj\n', 'YWJj ', 'YW-J',
    'data:text/plain;base64,YWJj', 'data:image/png;charset=utf-8;base64,YWJj', 'https://host/image', '中文']) {
    expectError(() => decodeInlineImage(text), 400, 'invalid_image');
  }
  expectError(() => decodeInlineImage(null), 400, 'invalid_image');
  expectError(() => decodeInlineImage('x'.repeat(101), 3), 413, 'image_too_large');
  expectError(() => decodeInlineImage(Buffer.from('abcd').toString('base64'), 3), 413, 'image_too_large');
  assert.equal(decodeInlineImage('YWJj', 3).length, 3);
});

test('仅inline图片与可省框，字段/base64/null错误优先级；bbox有限原图xyxy', () => {
  for (const value of [null, [], 'x', 2]) expectError(() => parseInferRequest(JSON.stringify(value)), 400, 'invalid_json');
  for (const value of [{}, { image_path: 'secret' }, payload({ model: 'x' }), payload({ image_url: 'http://host' })]) {
    expectError(() => parseInferRequest(JSON.stringify(value)), 400, 'invalid_request');
  }
  expectError(() => parseInferRequest('{"image_base64":"bad","bbox_xyxy":null}'), 400, 'invalid_image');
  expectError(() => parseInferRequest(JSON.stringify(payload({ bbox_xyxy: null }))), 400, 'invalid_bbox');
  assert.equal(parseInferRequest(JSON.stringify(payload())).bbox, undefined);
  assert.deepEqual(validateBBox(undefined, 100, 80), { boxXYXY: [0, 0, 100, 80], bboxSource: 'full_image_fallback' });
  assert.deepEqual(validateBBox([0, 0, 100, 80], 100, 80), { boxXYXY: [0, 0, 100, 80], bboxSource: 'supplied' });
  assert.equal(validateBBox([.5, .25, 99.5, 80], 100, 80).bboxSource, 'supplied');
  for (const box of [null, [], [false, 0, 1, 1], ['0', 0, 1, 1], [0, 0, NaN, 1], [0, 0, Infinity, 1],
    [0, 0, 0, 1], [2, 0, 1, 1], [-1, 0, 1, 1], [0, 0, 101, 80], [0, 0, 100, 81]]) {
    expectError(() => validateBBox(box, 100, 80), 400, 'invalid_bbox');
  }
});

test('fake engine接收逐字节原图与undefined/小数框，返回真实标注的DML DTO', async () => {
  await withServer(async ({ port, engine }) => {
    const health = await request(port);
    assert.equal(health.status, 200);
    assert.equal(health.json.device, 'dml:0');
    assert.equal(engine.healthCalls, 1);
    assert.equal(engine.calls.length, 0);
    const response = await request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS, body: payload() });
    assert.equal(response.status, 200);
    assert.deepEqual(engine.calls[0].bytes, PNG);
    assert.equal(engine.calls[0].box, undefined);
    assert.equal(response.json.bboxSource, 'full_image_fallback');
    assert.equal(response.json.source, NODE_SOURCE);
    assert.equal(response.json.memory.gpuAllocator, 'unknown');
    const box = [.5, 1.25, 99, 80];
    const supplied = await request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS, body: payload({ bbox_xyxy: box }) });
    assert.equal(supplied.status, 200);
    assert.deepEqual(engine.calls[1].box, box);
    assert.deepEqual(supplied.json.boxXYXY, box);
    assert.equal(supplied.json.bboxSource, 'supplied');
    for (const bytes of [Buffer.from([255, 216, 255, 1]), Buffer.from('BMfake'), Buffer.from('RIFFfakeWEBPfake')]) {
      await request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS, body: { image_base64: bytes.toString('base64') } });
      assert.deepEqual(engine.calls.at(-1).bytes, bytes);
    }
    // 只证明传输不重编码；fake engine 不会解码这些格式，不能充当真实图片通过证据。
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers.connection, 'close');
    assert.equal(response.headers.vary, 'Origin');
    assert.equal(Number(response.headers['content-length']), Buffer.byteLength(response.text));
  });
});

test('Bearer精确前缀/重复头，GET/POST鉴权优先于未知路由，其他已知方法405', async () => {
  await withServer(async ({ port, engine }) => {
    for (const authorization of [undefined, 'bearer session-secret', 'Bearer wrong', 'Basic session-secret', 'Bearer session-secret extra']) {
      const response = await request(port, { path: '/missing', headers: authorization ? { Authorization: authorization } : {} });
      assert.equal(response.status, 401);
      assert.equal(response.json.error.code, 'unauthorized');
    }
    const auth = { Authorization: `Bearer ${TOKEN}` };
    for (const path of ['/health/', '/health?x=1', '/%68ealth', '//health', '/missing']) assert.equal((await request(port, { path, headers: auth })).status, 404);
    assert.equal((await request(port, { headers: auth })).status, 200);
    const unknown = await request(port, { method: 'POST', path: '/missing', headers: auth, body: 'invalid' });
    assert.equal(unknown.status, 404);
    assert.equal((await request(port, { method: 'POST', path: '/infer', body: 'invalid' })).status, 401);
    const duplicate = await rawRequest(port, rawHead('/health', [`Authorization: Bearer ${TOKEN}`, `Authorization: Bearer ${TOKEN}`], 'GET'));
    assert.equal(duplicate.status, 401);
    assert.equal(duplicate.json.error.code, 'unauthorized');
    for (const method of ['HEAD', 'PUT', 'DELETE', 'PATCH', 'TRACE']) assert.equal((await request(port, { method })).status, 405);
    const tunnel = await rawRequest(port, rawHead('host:443', [], 'CONNECT'));
    assert.equal(tunnel.status, 405);
    assert.match(tunnel.text, /Cache-Control: no-store/i);
    assert.equal(engine.calls.length, 0);
  }, { options: { apiToken: TOKEN } });
  await withServer(async ({ port }) => {
    assert.equal((await request(port, { headers: { Authorization: 'wrong' } })).status, 200);
    assert.equal((await rawRequest(port, 'GET /health HTTP/1.1\r\nConnection: close\r\n\r\n')).status, 200);
    const upgrade = await rawRequest(port, rawHead('/health', ['Connection: Upgrade', 'Upgrade: websocket'], 'GET'));
    assert.equal(upgrade.status, 200);
    assert.equal(upgrade.json.type, 'hmr2.health');
    const body = JSON.stringify(payload());
    const upgradedPost = await rawRequest(port, rawHead('/infer', ['Connection: Upgrade', 'Upgrade: websocket',
      'Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`]) + body);
    assert.equal(upgradedPost.status, 200);
    assert.equal(upgradedPost.json.type, 'hmr2.result');
  });
});

test('实际非白名单Origin只缺ACAO；严格白名单OPTIONS免Bearer且遵循状态优先级', async () => {
  await withServer(async ({ port }) => {
    const auth = { Authorization: `Bearer ${TOKEN}` };
    for (const origin of ['http://denied.example', 'null', `${ORIGIN}/`]) {
      const response = await request(port, { headers: { ...auth, Origin: origin } });
      assert.equal(response.status, 200);
      assert.equal(response.headers['access-control-allow-origin'], undefined);
    }
    const allowed = await request(port, { headers: { ...auth, Origin: ORIGIN } });
    assert.equal(allowed.headers['access-control-allow-origin'], ORIGIN);
    const missingToken = await request(port, { headers: { Origin: ORIGIN } });
    assert.equal(missingToken.status, 401);
    assert.equal(missingToken.headers['access-control-allow-origin'], ORIGIN);
    const preflight = { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization, CONTENT-TYPE, ,authorization' };
    const success = await request(port, { method: 'OPTIONS', path: '/infer', headers: preflight });
    assert.equal(success.status, 204);
    assert.equal(success.text, '');
    assert.equal(success.headers['content-length'], '0');
    assert.equal(success.headers['access-control-allow-methods'], 'GET, POST, OPTIONS');
    assert.equal(success.headers['access-control-allow-headers'], 'Authorization, Content-Type');
    assert.equal(success.headers['access-control-max-age'], '600');
    for (const origin of [undefined, 'null', 'http://denied.example']) {
      const response = await request(port, { method: 'OPTIONS', path: '/missing', headers: origin ? { Origin: origin } : {} });
      assert.equal(response.status, 403);
    }
    assert.equal((await request(port, { method: 'OPTIONS', path: '/missing', headers: preflight })).status, 404);
    for (const method of ['GET', 'post', '']) assert.equal((await request(port, { method: 'OPTIONS', path: '/infer', headers: { ...preflight, 'Access-Control-Request-Method': method } })).status, 405);
    assert.equal((await request(port, { method: 'OPTIONS', path: '/infer', headers: { ...preflight, 'Access-Control-Request-Headers': 'Authorization, X-Extra' } })).status, 403);
    assert.equal((await request(port, { method: 'OPTIONS', path: '/health', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' } })).status, 204);
  }, { options: { apiToken: TOKEN, corsOrigins: [ORIGIN] } });
});

test('Content-Type严格参数；HTTP错误JSON/UTF8/未知字段先于fake engine调用', async () => {
  await withServer(async ({ port, engine }) => {
    for (const type of ['application/json', 'APPLICATION/JSON; CHARSET=UTF-8']) {
      assert.equal((await request(port, { method: 'POST', path: '/infer', headers: { 'Content-Type': type }, body: payload() })).status, 200);
    }
    const count = engine.calls.length;
    for (const type of ['', 'text/plain', 'application/json;', 'application/json;charset="utf-8"',
      'application/json;charset=ascii', 'application/json;charset = utf-8', 'application/json;charset=utf-8;extra=x']) {
      const response = await request(port, { method: 'POST', path: '/infer', headers: { 'Content-Type': type }, body: payload() });
      assert.equal(response.status, 415);
    }
    const cases = [
      ['{"image_base64":"YWJj","image_base64":"YWJj"}', 'invalid_json'],
      ['{"image_base64":{"x":1,"x":2}}', 'invalid_json'],
      ['{"image_base64":"YWJj","bbox_xyxy":[{"x":1,"x":2}]}', 'invalid_json'],
      [Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), 'invalid_json'],
      [Buffer.from([0xff]), 'invalid_json'],
      ['[]', 'invalid_json'], [JSON.stringify(payload({ file: '/private' })), 'invalid_request'],
      [JSON.stringify(payload({ bbox_xyxy: null })), 'invalid_bbox'],
      ['{"image_base64":"bad","bbox_xyxy":null}', 'invalid_image'],
    ];
    for (const [body, code] of cases) {
      const response = await request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS, body });
      assert.equal(response.status, 400);
      assert.equal(response.json.error.code, code);
    }
    assert.equal(engine.calls.length, count);
  });
});

test('raw-socket分别证明应用CL/TE拒绝与Node原生parser早拒，不冒称handler执行', async () => {
  await withServer(async ({ port, engine }) => {
    const baseline = ['Content-Type: application/json'];
    const cases = [
      [baseline, '', 411, 'length_required'],
      [[...baseline, 'Content-Length: 0'], '', 400, 'invalid_json'],
      [[...baseline, 'Content-Length: 00000000000'], '', 413, 'request_too_large'],
      [[...baseline, 'Content-Length: 4097'], '', 413, 'request_too_large'],
      [[...baseline, 'Transfer-Encoding: chunked'], '0\r\n\r\n', 400, 'invalid_request'],
      [[...baseline, 'Content-Length: 2', 'Content-Length: 2'], '{}', 400, 'invalid_request'],
      [[...baseline, 'Transfer-Encoding: chunked', 'Content-Length: 2'], '0\r\n\r\n', 400, 'invalid_request'],
      [[...baseline, 'Content-Length: -1'], '', 400, 'invalid_request'],
      [[...baseline, 'Content-Length: 1.5'], '', 400, 'invalid_request'],
      [[...baseline, 'Content-Length: 10'], '{}', 400, 'invalid_request'],
    ];
    for (const [lines, body, status, code] of cases) {
      const response = await rawRequest(port, rawHead('/infer', lines) + body);
      assert.equal(response.status, status, lines.join(';'));
      assert.equal(response.json.error.code, code);
    }
    assert.equal(engine.calls.length, 0);
  }, { options: { maxRequestBytes: 4096 } });
  await withServer(async ({ port, server }) => {
    const parserErrors = [];
    server.on('clientError', (error) => { parserErrors.push(error.code); });
    const duplicate = await rawRequest(port, rawHead('/infer', ['Content-Type: application/json', 'Content-Length: 2', 'Content-Length: 2']) + '{}');
    assert.equal(duplicate.status, 400); // 原生parser比Bearer更早拒绝，不是原handler的401优先级。
    assert.deepEqual(parserErrors, ['HPE_UNEXPECTED_CONTENT_LENGTH']);
    const mixed = await rawRequest(port, rawHead('/infer', ['Content-Type: application/json', 'Transfer-Encoding: chunked', 'Content-Length: 2']) + '0\r\n\r\n');
    assert.equal(mixed.status, 400);
    assert.deepEqual(parserErrors, ['HPE_UNEXPECTED_CONTENT_LENGTH', 'HPE_INVALID_CONTENT_LENGTH']);
    const application = await rawRequest(port, rawHead('/infer', ['Content-Type: text/plain', 'Content-Length: 2']) + '{}');
    assert.equal(application.status, 401);
  }, { options: { apiToken: TOKEN } });
});

test('字节/编码/请求大小限额和单飞busy优先级由fake engine明确模拟', async () => {
  await withServer(async ({ port, engine }) => {
    const response = await request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS, body: { image_base64: Buffer.from('abcd').toString('base64') } });
    assert.equal(response.status, 413);
    assert.equal(response.json.error.code, 'image_too_large');
    assert.equal(engine.calls.length, 0);
  }, { options: { maxImageBytes: 3 } });
  const engine = fakeEngine();
  let release;
  let started;
  const entering = new Promise((resolveStart) => { started = resolveStart; });
  const held = new Promise((resolveRun) => { release = resolveRun; });
  let busy = false;
  engine.predictBytes = async (bytes, box) => {
    if (busy) throw new ServiceError(503, 'gpu_busy', '正在推理，请稍后重试');
    busy = true;
    started();
    try { await held; return dto(box); } finally { busy = false; }
  };
  await withServer(async ({ port }) => {
    const first = request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS, body: payload() });
    await entering;
    try {
      const second = await request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS, body: payload({ bbox_xyxy: ['invalid'] }) });
      assert.equal(second.status, 503);
      assert.equal(second.json.error.code, 'gpu_busy');
      const invalid = await request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS, body: { image_base64: 'bad' } });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.json.error.code, 'invalid_image');
    } finally { release(); }
    assert.equal((await first).status, 200);
    assert.equal(busy, false);
    const failure = await request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS, body: payload({ bbox_xyxy: [0, 0, 0, 80] }) });
    assert.equal(failure.status, 400);
    assert.equal(failure.json.error.code, 'invalid_bbox');
    assert.equal(busy, false);
    const overflow = await request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS,
      body: `{"image_base64":"${PNG.toString('base64')}","bbox_xyxy":[0,0,1e400,80]}` });
    assert.equal(overflow.json.error.code, 'invalid_bbox');
    assert.equal(busy, false);
  }, { engine });
});

test('业务错误保留而未知异常脱敏，非有限/循环/BigInt输出安全500', async () => {
  const cyclic = {}; cyclic.child = cyclic;
  for (const value of [{ x: NaN }, { nested: [Infinity] }, { x: -Infinity }, cyclic, { x: 1n }, { x: undefined },
    { x: '\ud800' }, { '\udc00': true }, new Date(0), { x: Infinity, toJSON() { return { safe: true }; } }]) {
    assert.throws(() => serializeFiniteJson(value));
  }
  assert.equal(serializeFiniteJson({ text: '中文😀' }).toString(), '{"text":"中文😀"}');
  const engine = fakeEngine();
  await withServer(async ({ port }) => {
    engine.health = () => { throw new ServiceError(503, 'resources_missing', '缺少固定资源'); };
    const known = await request(port);
    assert.equal(known.status, 503);
    assert.equal(known.json.error.message, '缺少固定资源');
    engine.health = () => { throw new Error('private-path/token/image-body'); };
    const unknown = await request(port);
    assert.equal(unknown.status, 500);
    assert.equal(unknown.json.error.code, 'internal_error');
    assert.doesNotMatch(unknown.text, /private-path|token\/|image-body|stack/);
    engine.health = async () => ({ nested: { invalid: Infinity } });
    const invalid = await request(port);
    assert.equal(invalid.status, 500);
    assert.equal(invalid.json.error.code, 'serialization_failed');
    engine.predictBytes = async () => cyclic;
    assert.equal((await request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS, body: payload() })).json.error.code, 'serialization_failed');
  }, { engine });
});

test('固定公开HTML每次nonce不同且CSP一致，Three同源/no-store，任意路径不暴露', async () => {
  await withAssets(async (assets) => {
    await withServer(async ({ port, engine }) => {
      const first = await request(port, { path: '/' });
      const second = await request(port, { path: '/' });
      assert.equal(first.status, 200);
      const nonce = /nonce="([A-Za-z0-9_-]{32})"/.exec(first.text)?.[1];
      assert.ok(nonce);
      assert.notEqual(first.text, second.text);
      assert.ok(first.headers['content-security-policy'].includes(`script-src 'nonce-${nonce}' 'self'`));
      assert.ok(first.headers['content-security-policy'].includes("connect-src 'self'"));
      assert.equal(first.headers['x-frame-options'], 'DENY');
      assert.equal(first.headers['referrer-policy'], 'no-referrer');
      assert.equal(first.headers['cache-control'], 'no-store');
      assert.equal(Number(first.headers['content-length']), Buffer.byteLength(first.text));
      assert.doesNotMatch(first.text, /__HMR_NONCE__|session-secret/);
      const module = await request(port, { path: '/hmr2-three.js' });
      assert.equal(module.status, 200);
      assert.equal(module.headers['cross-origin-resource-policy'], 'same-origin');
      assert.equal(module.headers['content-type'], 'text/javascript; charset=utf-8');
      assert.equal((await request(port, { path: '/?x=1' })).status, 401);
      for (const path of ['/?x=1', '/hmr2-three.js?x=1', '/../../core/errors.mjs', '/%2e%2e/private']) {
        assert.equal((await request(port, { path, headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
      }
      assert.equal(engine.healthCalls, 0);
      assert.equal(engine.calls.length, 0);
    }, { assets, options: { apiToken: TOKEN } });
  });
});

test('静态资源缺失/坏UTF8/重复nonce/超限/空Three可控503而不泄露路径', async () => {
  await withServer(async ({ port }) => {
    assert.equal((await request(port, { path: '/' })).json.error.code, 'test_page_unavailable');
    assert.equal((await request(port, { path: '/hmr2-three.js' })).json.error.code, 'three_module_unavailable');
  });
  await withAssets(async (assets) => {
    await withServer(async ({ port }) => {
      for (const bytes of [Buffer.from([0xff]), Buffer.from('no marker'), Buffer.from(`${PAGE}${PAGE}`), Buffer.alloc(1024 * 1024 + 1, 32)]) {
        await writeFile(assets.testPagePath, bytes);
        const response = await request(port, { path: '/' });
        assert.equal(response.status, 503);
        assert.equal(response.json.error.code, 'test_page_unavailable');
        assert.ok(!response.text.includes(assets.directory));
      }
      for (const bytes of [Buffer.alloc(0), Buffer.alloc(1024 * 1024 + 1, 32)]) {
        await writeFile(assets.threeModulePath, bytes);
        const response = await request(port, { path: '/hmr2-three.js' });
        assert.equal(response.status, 503);
        assert.equal(response.json.error.code, 'three_module_unavailable');
      }
    }, { assets });
  });
});

test('Three symlink拒绝（Windows无权限时明确skip，不申请提权）', async (t) => {
  await withAssets(async (assets) => {
    const link = join(assets.directory, 'link.mjs');
    try { await symlink(assets.threeModulePath, link, 'file'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('当前Windows不允许创建测试symlink，未验证此操作分支'); return; }
      throw error;
    }
    await withServer(async ({ port }) => {
      const response = await request(port, { path: '/hmr2-three.js' });
      assert.equal(response.status, 503);
      assert.equal(response.json.error.code, 'three_module_unavailable');
    }, { assets: { ...assets, threeModulePath: link } });
  });
});

test('慢读只关闭自有socket，完整body后的长fake推理不受读超时限制', async () => {
  await withServer(async ({ port }) => {
    const response = await rawRequest(port, rawHead('/infer', ['Content-Type: application/json', 'Content-Length: 100']) + '{', { finish: false });
    assert.equal(response.status, 0);
  }, { options: { socketReadTimeoutMs: 60 } });
  const engine = fakeEngine();
  engine.predictBytes = async () => { await new Promise((resolveRun) => setTimeout(resolveRun, 160)); return dto(); };
  engine.health = async () => { await new Promise((resolveRun) => setTimeout(resolveRun, 160)); return { type: 'hmr2.health', ready: false }; };
  await withServer(async ({ port }) => {
    assert.equal((await request(port)).status, 200);
    assert.equal((await request(port, { method: 'POST', path: '/infer', headers: JSON_HEADERS, body: payload() })).status, 200);
  }, { engine, options: { socketReadTimeoutMs: 60 } });
});
