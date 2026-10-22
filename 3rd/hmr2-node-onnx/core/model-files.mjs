import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { ServiceError } from './errors.mjs';
import { DEFAULT_MODEL_DIR } from './paths.mjs';

// 对应.src/framework/hmr2-node-onnx-project-service.md的模型获取/自测流程。
// 只允许已审计的两项外置artifact；原模型目录始终仅打开读取句柄。
const NAMES = Object.freeze(['model.onnx', 'model.onnx.data']);
const DEFAULT_CATALOG = fileURLToPath(new URL('./model-catalog.json', import.meta.url));
const LOCK_NAME = '.install.lock';
const READY_NAME = 'installed.json';
const REDIRECT_LIMIT = 5;
const IDLE_TIMEOUT_MS = 30_000;
const CHUNK_BYTES = 256 * 1024;

function error(status, code, message) {
  return new ServiceError(status, code, message);
}

function catalogChecked(value) {
  const validHeader = value && typeof value === 'object' && !Array.isArray(value)
    && value.schemaVersion === 1 && typeof value.id === 'string' && value.id.trim()
    && typeof value.version === 'string' && value.version.trim();
  if (!validHeader || !Array.isArray(value.files) || value.files.length !== 2) {
    throw error(500, 'model_catalog_invalid', '模型catalog必须含版本及两个固定artifact');
  }
  const entries = new Map();
  for (const item of value.files) {
    const valid = item && typeof item === 'object' && NAMES.includes(item.path)
      && Number.isSafeInteger(item.bytes) && item.bytes > 0
      && typeof item.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(item.sha256);
    if (!valid || entries.has(item.path)) {
      throw error(500, 'model_catalog_invalid', '模型catalog文件名、字节数或SHA-256无效');
    }
    entries.set(item.path, Object.freeze({
      path: item.path, bytes: item.bytes, sha256: item.sha256.toLowerCase(),
    }));
  }
  if (!NAMES.every((name) => entries.has(name))) {
    throw error(500, 'model_catalog_invalid', '模型catalog缺少固定artifact');
  }
  return Object.freeze({ ...value, files: Object.freeze(NAMES.map((name) => entries.get(name))) });
}

function absoluteDirectory(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw error(400, 'model_path_unsafe', `${label}必须是明确目录`);
  }
  const absolute = path.resolve(value);
  if (absolute === path.parse(absolute).root) {
    throw error(400, 'model_path_unsafe', `${label}不能是文件系统根目录`);
  }
  return absolute;
}

function child(root, name) {
  const absolute = path.resolve(root, name);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..'
      || path.isAbsolute(relative) || path.dirname(absolute) !== root) {
    throw error(400, 'model_path_unsafe', '模型路径必须是已确认目录的直接子项');
  }
  return absolute;
}

async function statOrMissing(absolute) {
  try {
    return await fs.lstat(absolute);
  } catch (cause) {
    if (cause.code === 'ENOENT') return null;
    throw cause;
  }
}

// 从磁盘根逐级lstat，不允许通过中间junction/symlink绕到用户原资源。
async function checkedDirectory(absolute, create = false) {
  const root = path.parse(absolute).root;
  let current = root;
  const segments = path.relative(root, absolute).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    let stats = await statOrMissing(current);
    if (!stats && create) {
      try {
        await fs.mkdir(current);
      } catch (cause) {
        if (cause.code !== 'EEXIST') throw cause;
      }
      stats = await statOrMissing(current);
    }
    if (!stats) return false;
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw error(400, 'model_path_unsafe', '模型目录及其父目录不能是链接或非目录');
    }
  }
  return true;
}

function sameFile(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino;
}

async function checkedFile(absolute, allowMissing = false) {
  await checkedDirectory(path.dirname(absolute));
  const stats = await statOrMissing(absolute);
  if (!stats && allowMissing) return null;
  if (!stats) throw error(503, 'model_missing', '模型artifact缺失，请先获取模型');
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw error(400, 'model_path_unsafe', '模型artifact必须是普通文件，禁止符号链接');
  }
  return stats;
}

async function readableFile(absolute, entry) {
  const before = await checkedFile(absolute);
  if (before.size !== entry.bytes) {
    throw error(422, 'model_integrity_mismatch', '模型artifact字节数与catalog不符');
  }
  const handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(before, opened) || opened.size !== entry.bytes) {
      throw error(400, 'model_path_unsafe', '模型artifact在打开期间发生变化');
    }
    return handle;
  } catch (cause) {
    await handle.close();
    throw cause;
  }
}

async function hashFile(absolute, entry) {
  const handle = await readableFile(absolute, entry);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    const input = handle.createReadStream({ autoClose: true, highWaterMark: CHUNK_BYTES });
    for await (const chunk of input) {
      bytes += chunk.length;
      if (bytes > entry.bytes) throw error(422, 'model_integrity_mismatch', '模型artifact超过catalog字节数');
      hash.update(chunk);
    }
    if (bytes !== entry.bytes || hash.digest('hex') !== entry.sha256) {
      throw error(422, 'model_integrity_mismatch', '模型artifact大小或SHA-256与catalog不符');
    }
  } finally {
    await handle.close();
  }
}

export async function loadCatalog(catalogPath = DEFAULT_CATALOG) {
  try {
    const absolute = path.resolve(catalogPath);
    const stats = await checkedFile(absolute);
    if (stats.size > 128 * 1024) throw error(500, 'model_catalog_invalid', '模型catalog过大');
    const handle = await readableFile(absolute, { bytes: stats.size });
    const chunks = [];
    let bytes = 0;
    try {
      for await (const chunk of handle.createReadStream({ autoClose: true, highWaterMark: 16 * 1024 })) {
        bytes += chunk.length;
        if (bytes > 128 * 1024) throw error(500, 'model_catalog_invalid', '模型catalog读取超过上限');
        chunks.push(chunk);
      }
      return catalogChecked(JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')));
    } finally {
      await handle.close();
    }
  } catch (cause) {
    if (cause instanceof ServiceError && cause.code === 'model_catalog_invalid') throw cause;
    throw error(500, 'model_catalog_invalid', '无法读取合法模型catalog');
  }
}

async function suppliedCatalog(catalog) {
  return catalog === undefined ? loadCatalog() : catalogChecked(catalog);
}

export async function verifyModel({ modelDir = DEFAULT_MODEL_DIR, catalog } = {}) {
  const definition = await suppliedCatalog(catalog);
  const directory = absoluteDirectory(modelDir, 'modelDir');
  try {
    if (!await checkedDirectory(directory)) throw error(503, 'model_missing', '模型目录缺失，请先获取模型');
    for (const entry of definition.files) await hashFile(child(directory, entry.path), entry);
    return {
      modelDir: directory,
      modelPath: child(directory, NAMES[0]),
      dataPath: child(directory, NAMES[1]),
      files: definition.files,
      version: definition.version,
      verified: true,
    };
  } catch (cause) {
    if (cause instanceof ServiceError) throw cause;
    throw error(503, 'model_verification_failed', '模型文件无法读取或验证');
  }
}

async function cachedModel(directory, definition) {
  if (!await checkedDirectory(directory)) return null;
  const entries = await Promise.all([...NAMES, READY_NAME].map((name) => checkedFile(child(directory, name), true)));
  if (entries.every((entry) => entry === null)) return null;
  if (!entries[0] || !entries[1]) {
    throw error(409, 'model_target_invalid', '目标已有不完整模型，拒绝覆盖；请人工检查目标目录');
  }
  try {
    return await verifyModel({ modelDir: directory, catalog: definition });
  } catch (cause) {
    if (cause instanceof ServiceError && cause.code === 'model_path_unsafe') throw cause;
    throw error(409, 'model_target_invalid', '目标已有无效模型，拒绝覆盖；请人工检查目标目录');
  }
}

function loopbackHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const octets = host.split('.');
  return octets.length === 4 && octets.every((value) => /^\d{1,3}$/.test(value) && Number(value) <= 255)
    && Number(octets[0]) === 127;
}

function allowedUrl(value, policy) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw error(400, 'model_source_invalid', '模型base URL或重定向URL无效');
  }
  const validHttps = url.protocol === 'https:';
  const validHttp = url.protocol === 'http:' && policy.allowLoopbackHttp && loopbackHostname(url.hostname);
  if ((!validHttps && !validHttp) || (policy.loopbackOnly && !loopbackHostname(url.hostname))) {
    throw error(400, 'model_source_invalid', '模型来源须使用HTTPS；测试HTTP及其重定向只能访问loopback');
  }
  url.hash = '';
  return url;
}

function loopbackLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (cause, address, family) => {
    if (cause) return callback(cause);
    const values = Array.isArray(address) ? address.map((item) => item.address) : [address];
    if (!values.every((value) => value !== 'localhost' && loopbackHostname(value))) {
      return callback(error(400, 'model_source_invalid', '测试来源DNS必须解析到loopback'));
    }
    return callback(null, address, family);
  });
}

async function responseFor(initial, policy) {
  let url = initial;
  for (let redirects = 0; redirects <= REDIRECT_LIMIT; redirects += 1) {
    url = allowedUrl(url, policy);
    const response = await new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const request = client.get(url, {
        headers: { accept: 'application/octet-stream', 'accept-encoding': 'identity' },
        lookup: (policy.loopbackOnly || url.protocol === 'http:') ? loopbackLookup : undefined,
      }, resolve);
      request.setTimeout(IDLE_TIMEOUT_MS, () => request.destroy(error(504, 'model_download_timeout', '模型下载连接空闲超时')));
      request.once('error', reject);
    });
    const status = response.statusCode;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.location;
      response.destroy();
      if (!location || redirects === REDIRECT_LIMIT) {
        throw error(502, 'model_download_redirect', '模型下载重定向缺失或次数超过限制');
      }
      try {
        url = allowedUrl(new URL(location, url), policy);
      } catch (cause) {
        if (cause instanceof ServiceError) throw cause;
        throw error(400, 'model_source_invalid', '模型下载重定向URL无效');
      }
      continue;
    }
    if (status !== 200) {
      response.destroy();
      throw error(502, 'model_download_status', '模型下载服务未返回完整成功响应');
    }
    response.setTimeout(IDLE_TIMEOUT_MS, () => response.destroy(error(504, 'model_download_timeout', '模型下载响应空闲超时')));
    return response;
  }
  throw error(502, 'model_download_redirect', '模型下载重定向次数超过限制');
}

function checkHeaders(response, entry) {
  const length = response.headers['content-length'];
  const encoding = response.headers['content-encoding'];
  if (encoding && encoding.toLowerCase() !== 'identity') {
    throw error(502, 'model_download_encoding', '模型下载不接受压缩传输');
  }
  if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) !== entry.bytes)) {
    throw error(422, 'model_integrity_mismatch', '模型下载Content-Length与catalog不符');
  }
}

async function removeOwned(root, name, identity) {
  const absolute = child(root, name);
  await checkedDirectory(root);
  const stats = await checkedFile(absolute, true);
  if (!stats) return;
  if (!sameFile(stats, identity)) throw error(409, 'model_cleanup_conflict', '自有临时文件已被替换，拒绝清理');
  // 删除前已重新验证绝对直接子路径、普通文件与创建时的identity。
  await fs.unlink(absolute);
}

async function streamArtifact(input, directory, entry, source, onProgress, identities) {
  const absolute = child(directory, entry.path);
  await checkedDirectory(directory);
  const output = await fs.open(absolute, 'wx', 0o600);
  const identity = await output.stat();
  // 创建成功即登记identity；失败清理不能采用事后读取到的替换文件。
  identities.set(entry.path, identity);
  let bytes = 0;
  const hash = createHash('sha256');
  try {
    const counter = new Transform({
      async transform(chunk, encoding, callback) {
        try {
          bytes += chunk.length;
          if (bytes > entry.bytes) throw error(422, 'model_integrity_mismatch', '模型下载或复制超过catalog字节数');
          hash.update(chunk);
          // 进度只含固定文件名和计数，不含带凭据URL或本机路径。
          await onProgress?.({ source, file: entry.path, bytes, totalBytes: entry.bytes });
          callback(null, chunk);
        } catch (cause) {
          callback(cause);
        }
      },
    });
    const writer = new Writable({
      async write(chunk, encoding, callback) {
        try {
          let offset = 0;
          while (offset < chunk.length) {
            const written = await output.write(chunk, offset, chunk.length - offset, null);
            if (!written.bytesWritten) throw error(500, 'model_install_failed', '临时模型写入未取得进展');
            offset += written.bytesWritten;
          }
          callback();
        } catch (cause) {
          callback(cause);
        }
      },
    });
    // 不使用autoClose:false的FileHandle写流：pipeline可能等待其close导致挂起。
    await pipeline(input, counter, writer);
    if (bytes !== entry.bytes || hash.digest('hex') !== entry.sha256) {
      throw error(422, 'model_integrity_mismatch', '模型下载或复制的大小/SHA-256与catalog不符');
    }
    await output.sync();
    return identity;
  } catch (cause) {
    if (cause instanceof ServiceError) throw cause;
    throw error(502, 'model_transfer_failed', '模型传输中断、截断或本机文件无法读取');
  } finally {
    await output.close();
  }
}

async function stageLocal(directory, stage, definition, onProgress, identities) {
  if (!await checkedDirectory(directory)) throw error(503, 'model_source_missing', '本机模型源不存在，且未配置远程HTTPS来源');
  const handles = [];
  try {
    // 两项先检查存在/长度，避免第一项复制很久后才发现第二项缺失。
    for (const entry of definition.files) handles.push(await readableFile(child(directory, entry.path), entry));
    for (let index = 0; index < definition.files.length; index += 1) {
      const entry = definition.files[index];
      const input = handles[index].createReadStream({ autoClose: true, highWaterMark: CHUNK_BYTES });
      identities.set(entry.path, await streamArtifact(input, stage, entry, 'local', onProgress, identities));
    }
  } catch (cause) {
    if (cause instanceof ServiceError && cause.code === 'model_missing') {
      throw error(503, 'model_source_missing', '本机模型源缺少固定artifact，且未配置远程HTTPS来源');
    }
    throw cause;
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
  }
}

async function stageRemote(baseUrl, stage, definition, onProgress, identities, allowLoopbackHttp) {
  const policy = { allowLoopbackHttp: allowLoopbackHttp === true, loopbackOnly: false };
  const base = allowedUrl(baseUrl, policy);
  policy.loopbackOnly = base.protocol === 'http:';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  for (const entry of definition.files) {
    const url = new URL(entry.path, base);
    // 允许调用端显式base URL带查询令牌，任何错误/进度仍不回显令牌。
    url.search = base.search;
    let response;
    try {
      response = await responseFor(url, policy);
      checkHeaders(response, entry);
      identities.set(entry.path, await streamArtifact(response, stage, entry, 'remote', onProgress, identities));
    } catch (cause) {
      response?.destroy();
      if (cause instanceof ServiceError) throw cause;
      throw error(502, 'model_download_failed', '远程模型连接或下载失败；未安装模型');
    }
  }
}

async function installFile(stage, directory, name, identity, installed) {
  const from = child(stage, name);
  const to = child(directory, name);
  await checkedDirectory(stage);
  await checkedDirectory(directory);
  const stats = await checkedFile(from);
  if (!sameFile(stats, identity)) throw error(409, 'model_install_conflict', '临时artifact已改变，拒绝安装');
  if (await checkedFile(to, true)) throw error(409, 'model_target_invalid', '固定目标已经存在，拒绝覆盖');
  try {
    // link为同文件系统原子no-clobber提交；不能用可能覆盖竞争目标的POSIX rename。
    await fs.link(from, to);
  } catch (cause) {
    if (cause.code === 'EEXIST') throw error(409, 'model_target_invalid', '固定目标竞争创建，拒绝覆盖');
    throw cause;
  }
  installed.set(name, identity);
}

async function cleanStage(stage, identities, stageIdentity) {
  await checkedDirectory(stage);
  if (!sameFile(await fs.lstat(stage), stageIdentity)) {
    throw error(409, 'model_cleanup_conflict', '自有临时目录已被替换，拒绝清理');
  }
  const existing = await fs.readdir(stage);
  for (const name of existing) {
    if (!identities.has(name)) throw error(409, 'model_cleanup_conflict', '临时目录含未知子项，拒绝清理');
    await removeOwned(stage, name, identities.get(name));
  }
  await checkedDirectory(stage);
  // 只rmdir已确认的自有空目录，不递归删除未知树。
  await fs.rmdir(stage);
}

export async function acquireModel({
  modelDir = DEFAULT_MODEL_DIR, sourceDir, baseUrl, catalog, onProgress, allowLoopbackHttp = false,
} = {}) {
  const definition = await suppliedCatalog(catalog);
  const directory = absoluteDirectory(modelDir, 'modelDir');
  const cached = await cachedModel(directory, definition);
  if (cached) return { source: 'cache', modelDir: directory, files: cached.files, version: definition.version };
  const remote = baseUrl !== undefined && baseUrl !== null && baseUrl !== '';
  if (!remote && !sourceDir) throw error(503, 'model_source_missing', '未找到本机模型源，且未配置远程HTTPS base URL');
  const local = remote ? null : absoluteDirectory(sourceDir, 'sourceDir');
  if (local === directory) throw error(400, 'model_source_invalid', '本机源与目标不能是同一个未完成目录');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw error(400, 'model_options_invalid', 'onProgress必须是函数');
  await checkedDirectory(directory, true);
  const lockPath = child(directory, LOCK_NAME);
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx', 0o600);
  } catch (cause) {
    if (cause.code === 'EEXIST') throw error(409, 'model_install_busy', '模型目录存在安装锁；请等待安装完成或人工检查遗留锁');
    throw error(500, 'model_install_failed', '无法创建模型安装锁');
  }
  const lockIdentity = await lock.stat();
  const stage = child(directory, `.install-${randomUUID()}`);
  const identities = new Map();
  const installed = new Map();
  let stageCreated = false;
  let stageIdentity;
  let committed = false;
  try {
    // 加锁后再次检查，防止另一个完成安装的调用与最初cache检查交错。
    const rechecked = await cachedModel(directory, definition);
    if (rechecked) return { source: 'cache', modelDir: directory, files: rechecked.files, version: definition.version };
    await fs.mkdir(stage, { mode: 0o700 });
    stageCreated = true;
    stageIdentity = await fs.lstat(stage);
    const source = remote ? 'remote' : 'local';
    if (remote) await stageRemote(baseUrl, stage, definition, onProgress, identities, allowLoopbackHttp);
    else await stageLocal(local, stage, definition, onProgress, identities);
    for (const entry of definition.files) await hashFile(child(stage, entry.path), entry);
    const ready = child(stage, READY_NAME);
    const readyHandle = await fs.open(ready, 'wx', 0o600);
    try {
      identities.set(READY_NAME, await readyHandle.stat());
      await readyHandle.writeFile(`${JSON.stringify({
        schemaVersion: 1, id: definition.id, version: definition.version, files: definition.files,
        source, installedAt: new Date().toISOString(),
      }, null, 2)}\n`, 'utf8');
      await readyHandle.sync();
    } finally {
      await readyHandle.close();
    }
    for (const entry of definition.files) await installFile(stage, directory, entry.path, identities.get(entry.path), installed);
    await verifyModel({ modelDir: directory, catalog: definition });
    await installFile(stage, directory, READY_NAME, identities.get(READY_NAME), installed);
    committed = true;
    return { source, modelDir: directory, files: definition.files, version: definition.version };
  } catch (cause) {
    if (cause instanceof ServiceError) throw cause;
    throw error(500, 'model_install_failed', '模型获取或安装失败；未声明模型就绪');
  } finally {
    try {
      if (!committed) {
        for (const [name, identity] of installed) await removeOwned(directory, name, identity);
      }
      if (stageCreated) await cleanStage(stage, identities, stageIdentity);
    } finally {
      await lock.close();
      await removeOwned(directory, LOCK_NAME, lockIdentity);
    }
  }
}
