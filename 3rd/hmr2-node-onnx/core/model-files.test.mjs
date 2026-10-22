import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import * as fs from 'node:fs/promises';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { loadCatalog, verifyModel, acquireModel } from './model-files.mjs';

// 对应.src/framework/hmr2-node-onnx-project-service.md自测段；仅微型字节fixture，绝不加载ORT/GPU。
const GRAPH = Buffer.from('tiny-test-model-not-executable');
const DATA = Buffer.alloc(8193, 0x5a);
const HASH = (data) => createHash('sha256').update(data).digest('hex');
const BYTES = { 'model.onnx': GRAPH, 'model.onnx.data': DATA };

function tinyCatalog(overrides = {}) {
  return {
    schemaVersion: 1, id: 'hmr2-test-only', version: 'tiny-v1',
    licenseNote: '仅测试fixture，不是实际模型来源', provenance: { kind: 'synthetic' },
    files: Object.entries(BYTES).map(([name, data]) => ({ path: name, bytes: data.length, sha256: HASH(data) })),
    ...overrides,
  };
}

function failure(code) {
  return (cause) => cause?.name === 'ServiceError' && cause.code === code;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hmr2-model-files-test-'));
  const original = await fs.lstat(root);
  const links = new Set();
  const sourceDir = path.join(root, 'source');
  const modelDir = path.join(root, 'target');
  await fs.mkdir(sourceDir);
  for (const [name, bytes] of Object.entries(BYTES)) await fs.writeFile(path.join(sourceDir, name), bytes);
  t.after(async () => {
    const current = await fs.lstat(root);
    assert.equal(current.dev, original.dev);
    assert.equal(current.ino, original.ino);
    // 清理仅该测试mkdtemp的已核对普通子项；不fs.rm递归、不跟随测试junction。
    async function clean(directory) {
      const stats = await fs.lstat(directory);
      assert.ok(stats.isDirectory() && !stats.isSymbolicLink());
      for (const name of await fs.readdir(directory)) {
        const absolute = path.resolve(directory, name);
        assert.equal(path.dirname(absolute), directory);
        const relative = path.relative(root, absolute);
        assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
        const child = await fs.lstat(absolute);
        if (child.isSymbolicLink()) {
          assert.ok(links.has(absolute), '只清理本测试明确创建的链接本身');
          await fs.unlink(absolute);
          continue;
        }
        if (child.isDirectory()) await clean(absolute);
        else {
          assert.ok(child.isFile());
          await fs.unlink(absolute);
        }
      }
      const final = await fs.lstat(directory);
      assert.ok(final.isDirectory() && !final.isSymbolicLink());
      await fs.rmdir(directory);
    }
    await clean(root);
  });
  return { root, sourceDir, modelDir, links, catalog: tinyCatalog() };
}

async function endpoint(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    // 只关闭自己创建的port0 Server句柄，不查询或操作任何用户PID。
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((cause) => cause ? reject(cause) : resolve()));
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/files/` };
}

function serveBytes(request, response) {
  const name = new URL(request.url, 'http://fixture.invalid').pathname.split('/').at(-1);
  const bytes = BYTES[name];
  if (!bytes) return response.writeHead(404).end();
  response.writeHead(200, { 'content-length': bytes.length });
  response.end(bytes);
}

async function emptyTarget(modelDir) {
  assert.deepEqual(await fs.readdir(modelDir), []);
}

test('catalog校验固定两文件、正整数字节与完整SHA，拒绝路径和重复项', async (t) => {
  const f = await fixture(t);
  const catalogPath = path.join(f.root, 'catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify(f.catalog));
  const loaded = await loadCatalog(catalogPath);
  assert.equal(loaded.version, 'tiny-v1');
  assert.deepEqual(loaded.files.map((entry) => entry.path), ['model.onnx', 'model.onnx.data']);
  assert.ok(Object.isFrozen(loaded.files));
  const badFiles = [
    [{ ...f.catalog.files[0], path: '../model.onnx' }, f.catalog.files[1]],
    [f.catalog.files[0], f.catalog.files[0]],
    [{ ...f.catalog.files[0], bytes: 0 }, f.catalog.files[1]],
    [{ ...f.catalog.files[0], bytes: 1.25 }, f.catalog.files[1]],
    [{ ...f.catalog.files[0], bytes: Number.MAX_SAFE_INTEGER + 1 }, f.catalog.files[1]],
    [{ ...f.catalog.files[0], sha256: 'abc' }, f.catalog.files[1]],
    [f.catalog.files[0]],
  ];
  for (const files of badFiles) {
    await assert.rejects(verifyModel({ modelDir: f.modelDir, catalog: tinyCatalog({ files }) }), failure('model_catalog_invalid'));
  }
  await fs.writeFile(catalogPath, '{broken');
  await assert.rejects(loadCatalog(catalogPath), failure('model_catalog_invalid'));
  await fs.writeFile(catalogPath, JSON.stringify(tinyCatalog({ schemaVersion: 2 })));
  await assert.rejects(loadCatalog(catalogPath), failure('model_catalog_invalid'));
});

test('本机流式导入两文件、installed最后提交、有效cache不改mtime', async (t) => {
  const f = await fixture(t);
  const records = [];
  const result = await acquireModel({ ...f, onProgress: (progress) => records.push(progress) });
  assert.equal(result.source, 'local');
  assert.equal(result.modelDir, path.resolve(f.modelDir));
  assert.ok(records.length >= 2);
  assert.ok(records.every((record) => Object.keys(record).sort().join() === 'bytes,file,source,totalBytes'));
  const verified = await verifyModel(f);
  assert.equal(verified.verified, true);
  assert.equal(verified.modelPath, path.join(f.modelDir, 'model.onnx'));
  assert.equal(verified.dataPath, path.join(f.modelDir, 'model.onnx.data'));
  const installed = JSON.parse(await fs.readFile(path.join(f.modelDir, 'installed.json'), 'utf8'));
  assert.equal(installed.source, 'local');
  assert.deepEqual(installed.files, f.catalog.files);
  assert.deepEqual((await fs.readdir(f.modelDir)).sort(), ['installed.json', 'model.onnx', 'model.onnx.data']);
  const before = await fs.stat(verified.dataPath);
  const cached = await acquireModel({ modelDir: f.modelDir, catalog: f.catalog });
  const after = await fs.stat(verified.dataPath);
  assert.equal(cached.source, 'cache');
  assert.equal(before.mtimeMs, after.mtimeMs);
  assert.equal(before.ino, after.ino);
  assert.deepEqual(await fs.readFile(path.join(f.sourceDir, 'model.onnx')), GRAPH);
});

test('已有完整有效两文件不强求installed marker，复用而不下载', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.modelDir);
  for (const [name, bytes] of Object.entries(BYTES)) await fs.writeFile(path.join(f.modelDir, name), bytes);
  const cached = await acquireModel({ modelDir: f.modelDir, catalog: f.catalog, baseUrl: 'https://no-public-model-source.invalid/' });
  assert.equal(cached.source, 'cache');
  assert.deepEqual((await fs.readdir(f.modelDir)).sort(), ['model.onnx', 'model.onnx.data']);
});

test('缺少本机及远程来源给model_source_missing，不伪造下载成功', async (t) => {
  const f = await fixture(t);
  await assert.rejects(acquireModel({ modelDir: f.modelDir, catalog: f.catalog }), failure('model_source_missing'));
  await assert.rejects(acquireModel({ ...f, sourceDir: path.join(f.root, 'missing') }), failure('model_source_missing'));
  await emptyTarget(f.modelDir);
  await fs.unlink(path.join(f.sourceDir, 'model.onnx.data'));
  await assert.rejects(acquireModel(f), failure('model_source_missing'));
  await emptyTarget(f.modelDir);
});

test('已有无效或不完整目标拒绝覆盖并保留原字节', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.modelDir);
  const original = Buffer.from('user-owned-invalid-target');
  await fs.writeFile(path.join(f.modelDir, 'model.onnx'), original);
  await assert.rejects(acquireModel(f), failure('model_target_invalid'));
  assert.deepEqual(await fs.readFile(path.join(f.modelDir, 'model.onnx')), original);
  await fs.writeFile(path.join(f.modelDir, 'model.onnx.data'), DATA);
  await assert.rejects(acquireModel(f), failure('model_target_invalid'));
  assert.deepEqual(await fs.readFile(path.join(f.modelDir, 'model.onnx')), original);
  assert.deepEqual((await fs.readdir(f.modelDir)).sort(), ['model.onnx', 'model.onnx.data']);
});

test('本机同长度SHA错误拒绝提交并清理自己的stage和锁', async (t) => {
  const f = await fixture(t);
  const bad = Buffer.from(DATA);
  bad[0] ^= 1;
  await fs.writeFile(path.join(f.sourceDir, 'model.onnx.data'), bad);
  await assert.rejects(acquireModel(f), failure('model_integrity_mismatch'));
  await emptyTarget(f.modelDir);
  assert.deepEqual(await fs.readFile(path.join(f.sourceDir, 'model.onnx.data')), bad);
});

test('远程只允许显式loopback HTTP，默认禁止HTTP且不发请求', async (t) => {
  const f = await fixture(t);
  let requests = 0;
  const e = await endpoint(t, (request, response) => { requests += 1; serveBytes(request, response); });
  await assert.rejects(acquireModel({ ...f, baseUrl: e.baseUrl }), failure('model_source_invalid'));
  assert.equal(requests, 0);
  await emptyTarget(f.modelDir);
});

test('远程fixture优先explicit URL，流式下载且进度/ready无凭据URL', async (t) => {
  const f = await fixture(t);
  const records = [];
  let requests = 0;
  const e = await endpoint(t, (request, response) => {
    requests += 1;
    assert.ok(request.url.includes('token=secret-value'));
    assert.equal(request.headers['accept-encoding'], 'identity');
    serveBytes(request, response);
  });
  const baseUrl = e.baseUrl.replace('http://', 'http://fixture-user:fixture-password@') + '?token=secret-value';
  const result = await acquireModel({ ...f, sourceDir: path.join(f.root, 'missing'), baseUrl,
    allowLoopbackHttp: true, onProgress: async (record) => records.push(record) });
  assert.equal(result.source, 'remote');
  assert.equal(requests, 2);
  assert.equal((await verifyModel(f)).verified, true);
  const rendered = JSON.stringify(records) + await fs.readFile(path.join(f.modelDir, 'installed.json'), 'utf8');
  for (const secret of ['secret-value', 'fixture-password', 'fixture-user', 'http://']) assert.ok(!rendered.includes(secret));
});

test('远程允许有限同loopback相对重定向，禁止链逃离loopback', async (t) => {
  const f = await fixture(t);
  const e = await endpoint(t, (request, response) => {
    if (request.url.startsWith('/files/')) return response.writeHead(302, { location: request.url.replace('/files/', '/final/') }).end();
    serveBytes(request, response);
  });
  assert.equal((await acquireModel({ ...f, baseUrl: e.baseUrl, allowLoopbackHttp: true })).source, 'remote');
  const rejected = await fixture(t);
  const outside = await endpoint(t, (request, response) => response.writeHead(302, { location: 'https://not-a-public-model-source.invalid/secret' }).end());
  await assert.rejects(acquireModel({ ...rejected, baseUrl: outside.baseUrl, allowLoopbackHttp: true }), failure('model_source_invalid'));
  await emptyTarget(rejected.modelDir);
});

test('重定向循环超过上限拒绝，错误不带URL凭据', async (t) => {
  const f = await fixture(t);
  let requests = 0;
  const e = await endpoint(t, (request, response) => { requests += 1; response.writeHead(302, { location: request.url }).end(); });
  await assert.rejects(acquireModel({ ...f, baseUrl: e.baseUrl + '?token=hidden-token', allowLoopbackHttp: true }), (cause) => {
    assert.equal(cause.code, 'model_download_redirect');
    assert.ok(!cause.message.includes('hidden-token'));
    return true;
  });
  assert.equal(requests, 6);
  await emptyTarget(f.modelDir);
});

test('404、Content-Length错、压缩传输、SHA错均不产生ready', async (t) => {
  const cases = [
    { name: '404', code: 'model_download_status', handler: (request, response) => response.writeHead(404).end('missing') },
    { name: 'length', code: 'model_integrity_mismatch', handler: (request, response) => response.writeHead(200, { 'content-length': GRAPH.length + 1 }).end(GRAPH) },
    { name: 'encoding', code: 'model_download_encoding', handler: (request, response) => response.writeHead(200, { 'content-encoding': 'gzip' }).end(GRAPH) },
    { name: 'sha', code: 'model_integrity_mismatch', handler: (request, response) => response.writeHead(200, { 'content-length': GRAPH.length }).end(Buffer.alloc(GRAPH.length, 1)) },
  ];
  for (const item of cases) {
    await t.test(item.name, async (nested) => {
      const f = await fixture(nested);
      const e = await endpoint(nested, item.handler);
      await assert.rejects(acquireModel({ ...f, baseUrl: e.baseUrl, allowLoopbackHttp: true }), failure(item.code));
      await emptyTarget(f.modelDir);
    });
  }
});

test('无Content-Length的chunked计数限制与短body均拒绝提交', async (t) => {
  for (const delta of [-1, 1]) {
    await t.test(`delta=${delta}`, async (nested) => {
      const f = await fixture(nested);
      const bytes = delta < 0 ? GRAPH.subarray(0, GRAPH.length - 1) : Buffer.concat([GRAPH, Buffer.from([0])]);
      const e = await endpoint(nested, (request, response) => { response.writeHead(200); response.write(bytes); response.end(); });
      await assert.rejects(acquireModel({ ...f, baseUrl: e.baseUrl, allowLoopbackHttp: true }), failure('model_integrity_mismatch'));
      await emptyTarget(f.modelDir);
    });
  }
});

test('声明完整长度但连接截断拒绝，不留下partial artifact', async (t) => {
  const f = await fixture(t);
  const e = await endpoint(t, (request, response) => {
    response.writeHead(200, { 'content-length': GRAPH.length });
    response.flushHeaders();
    response.write(GRAPH.subarray(0, 1));
    setImmediate(() => response.destroy());
  });
  await assert.rejects(acquireModel({ ...f, baseUrl: e.baseUrl, allowLoopbackHttp: true }), failure('model_transfer_failed'));
  await emptyTarget(f.modelDir);
});

test('流式安装持锁时并发获取清晰busy，首安装后复用cache', async (t) => {
  const f = await fixture(t);
  const entered = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  const first = acquireModel({ ...f, onProgress: async (record) => {
    if (record.file === 'model.onnx') { entered.resolve(); await release.promise; }
  } });
  await entered.promise;
  try {
    await assert.rejects(acquireModel(f), failure('model_install_busy'));
  } finally {
    release.resolve();
  }
  assert.equal((await first).source, 'local');
  assert.equal((await acquireModel(f)).source, 'cache');
});

test('提交前目标竞争创建不覆盖、不把竞争文件当自有文件清理', async (t) => {
  const f = await fixture(t);
  const foreign = Buffer.from('foreign-owner-wins');
  let created = false;
  await assert.rejects(acquireModel({ ...f, onProgress: async () => {
    if (!created) {
      created = true;
      await fs.writeFile(path.join(f.modelDir, 'model.onnx'), foreign, { flag: 'wx' });
    }
  } }), failure('model_target_invalid'));
  assert.deepEqual(await fs.readFile(path.join(f.modelDir, 'model.onnx')), foreign);
  assert.deepEqual(await fs.readdir(f.modelDir), ['model.onnx']);
});

test('目录junction不可作目标或本机源，根目录拒绝', async (t) => {
  const f = await fixture(t);
  const link = path.join(f.root, 'source-link');
  try {
    await fs.symlink(f.sourceDir, link, process.platform === 'win32' ? 'junction' : 'dir');
    f.links.add(link);
  } catch (cause) {
    if (['EPERM', 'ENOTSUP', 'EACCES'].includes(cause.code)) return t.skip('当前环境不能创建测试链接');
    throw cause;
  }
  await assert.rejects(acquireModel({ ...f, sourceDir: link }), failure('model_path_unsafe'));
  await assert.rejects(verifyModel({ ...f, modelDir: link }), failure('model_path_unsafe'));
  await assert.rejects(acquireModel({ ...f, modelDir: path.parse(f.root).root }), failure('model_path_unsafe'));
  await emptyTarget(f.modelDir);
  assert.deepEqual(await fs.readFile(path.join(f.sourceDir, 'model.onnx')), GRAPH);
});

test('进度回调失败不留下ready，普通verify报缺失或错误SHA', async (t) => {
  const f = await fixture(t);
  await assert.rejects(verifyModel(f), failure('model_missing'));
  await assert.rejects(acquireModel({ ...f, onProgress: async () => { throw new Error('secret must not escape'); } }), failure('model_transfer_failed'));
  await emptyTarget(f.modelDir);
  await acquireModel(f);
  const dataPath = path.join(f.modelDir, 'model.onnx.data');
  await fs.writeFile(dataPath, Buffer.alloc(DATA.length, 0));
  await assert.rejects(verifyModel(f), failure('model_integrity_mismatch'));
});

test('微型多块data按块进度复制，不把整个artifact聚合成Buffer', async (t) => {
  const f = await fixture(t);
  const data = Buffer.alloc(768 * 1024 + 3, 0x35);
  await fs.writeFile(path.join(f.sourceDir, 'model.onnx.data'), data);
  const catalog = tinyCatalog({ files: [f.catalog.files[0], { path: 'model.onnx.data', bytes: data.length, sha256: HASH(data) }] });
  const progress = [];
  await acquireModel({ ...f, catalog, onProgress: (item) => { if (item.file === 'model.onnx.data') progress.push(item.bytes); } });
  assert.ok(progress.length >= 4);
  assert.equal(progress.at(-1), data.length);
  assert.ok(progress.every((value, index) => index === 0 || value > progress[index - 1]));
  assert.equal((await verifyModel({ ...f, catalog })).verified, true);
});

test('第二目标竞争失败时回滚仅本次第一artifact，保留竞争文件', async (t) => {
  const f = await fixture(t);
  const foreign = Buffer.from('foreign-data-owner');
  let created = false;
  await assert.rejects(acquireModel({ ...f, onProgress: async (item) => {
    if (!created && item.file === 'model.onnx.data') {
      created = true;
      await fs.writeFile(path.join(f.modelDir, 'model.onnx.data'), foreign, { flag: 'wx' });
    }
  } }), failure('model_target_invalid'));
  assert.deepEqual(await fs.readFile(path.join(f.modelDir, 'model.onnx.data')), foreign);
  assert.deepEqual(await fs.readdir(f.modelDir), ['model.onnx.data']);
});

test('普通文件symlink拒绝验证，不读取其指向的source', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.modelDir);
  const link = path.join(f.modelDir, 'model.onnx');
  try {
    await fs.symlink(path.join(f.sourceDir, 'model.onnx'), link, 'file');
    f.links.add(link);
  } catch (cause) {
    if (['EPERM', 'ENOTSUP', 'EACCES'].includes(cause.code)) return t.skip('当前环境不能创建测试文件symlink');
    throw cause;
  }
  await fs.writeFile(path.join(f.modelDir, 'model.onnx.data'), DATA);
  await assert.rejects(verifyModel(f), failure('model_path_unsafe'));
  await assert.rejects(acquireModel(f), failure('model_path_unsafe'));
  assert.deepEqual(await fs.readFile(path.join(f.sourceDir, 'model.onnx')), GRAPH);
});

test('catalog读取限制128KiB，生产默认catalog仅读清单不读模型', async (t) => {
  const f = await fixture(t);
  const large = path.join(f.root, 'large-catalog.json');
  await fs.writeFile(large, Buffer.alloc(128 * 1024 + 1, 0x20));
  await assert.rejects(loadCatalog(large), failure('model_catalog_invalid'));
  const definition = await loadCatalog();
  assert.deepEqual(definition.files.map((entry) => entry.path), ['model.onnx', 'model.onnx.data']);
  assert.ok(definition.files[1].bytes > 2_000_000_000);
});
