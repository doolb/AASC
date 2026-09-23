const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { Readable } = require('node:stream');

const MMD_MANIFEST_RELATIVE_PATH = path.join('mmd', 'manifest.json');
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const STATIC_MMD_TIMEOUT_MS = 300000;
const STATIC_MMD_PROXY_PREFIX = '/api/mmd/static/';
const STATIC_MMD_SOURCE_BASE_URLS = Object.freeze([
  'http://192.168.1.39/mnt/mmd/miya-v1/',
  'http://10.221.70.87/mnt/mmd/miya-v1/',
  'http://c.aasc.us/mnt/mmd/miya-v1/',
]);

const STATIC_MMD_RELEASE = Object.freeze({
  host: 'c.aasc.us',
  publicPath: '/mnt/mmd/miya-v1/',
  resourceId: 'miya-default',
  motionResourceId: 'miya-default-motion',
  modelPath: 'mmd/miya/miya.pmx',
  motionPath: 'mmd/motions/miya-default.vmd',
  playMode: 'loop',
  version: 'ca07d84b494577f5dab90d71465bc08e01ec036fe66278a2393313b6febf56c6',
  files: Object.freeze([
    ['mmd/miya/miya.pmx', 4908850, 'ef8f5c366b5a9761ded99215426d824b822c8035055e45397521e0fa0c80bf8d'],
    ['mmd/miya/tex/1.png', 522908, 'd8a676dd5f76dd40925f926e051ce94563674bb9a37afa00609094567e5e264b'],
    ['mmd/miya/tex/1q.png', 667270, 'ec912073f6d75a454e7e2263d9820e9880bd39db8327f1443dd57804feb72da8'],
    ['mmd/miya/tex/2.png', 1038189, '9d57fc713e0fe0ef99a3713048f92e406732e10a9c702b86fed371080e834ade'],
    ['mmd/miya/tex/2q.png', 948170, '677266bcb970b42ceac6a1633f57a670855d0211436d8269b15a65d46defbf8e'],
    ['mmd/miya/tex/3.1.png', 24313, '4b60220cec5b0d958b0b77d936ff82f9317cf475c59abf5413378d8c91c6e03e'],
    ['mmd/miya/tex/3.png', 354468, '3b8ad670a287ea888187c537a07abec48632f5da612faea9de9bc67f3080d060'],
    ['mmd/miya/tex/4.png', 302085, '9daaa9eac3569dddd881a9edec903e2b5e836b37ab5a9937c3347bba0ca3f633'],
    ['mmd/miya/tex/5.png', 1163640, '4bba5edecf5bbf6711d14a985be069908bcafa5e64a395a6452a70ce17acd83c'],
    ['mmd/miya/tex/5q.png', 1011518, 'b8f5029b7f5d17ce59d2c07bd61f6eb4f81355e70481518fffb2473dd308f694'],
    ['mmd/miya/tex/7.png', 870412, 'd88014e12cce67de05263d625cec0683a15b48966025dc397f505b319203a529'],
    ['mmd/miya/tex/8.1.png', 1212408, '1cc067cb7fbb49a3f728e85cb8876b6199563f3de1a2578a0a9250a0e5c67e69'],
    ['mmd/miya/tex/8.2.png', 271304, 'a9ef6f408c71d4681b68c944eba194d9980e963b1092b2149208da4bcd44d0e5'],
    ['mmd/motions/miya-default.vmd', 134051, '3f83325c7a4a0606e6d72c43ff7752a685c6617214d4df66d6e08af3dd367cad'],
  ].map((file) => Object.freeze(file))),
});

const STATIC_MMD_ASSETS = new Map(STATIC_MMD_RELEASE.files.map(([assetPath, size, sha256]) => [assetPath, Object.freeze({
  path: assetPath,
  size,
  sha256,
  contentType: assetPath.endsWith('.png') ? 'image/png' : 'application/octet-stream',
})]));

const createMmdError = (message, statusCode = 503) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeStaticMmdAssetPath = (value) => {
  if (typeof value !== 'string'
    || !value
    || value.includes('\\')
    || value.includes('://')
    || value.startsWith('//')
    || /[?#%]/u.test(value)) {
    throw createMmdError('MMD static asset path is unsafe', 400);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')
    || value.startsWith('/')
    || /^[A-Za-z]:/u.test(value)
    || !value.startsWith('mmd/')) {
    throw createMmdError('MMD static asset path is unsafe', 400);
  }
  return value;
};

const resolveStaticMmdAsset = (relativePath) => {
  const normalizedPath = normalizeStaticMmdAssetPath(relativePath);
  const asset = STATIC_MMD_ASSETS.get(normalizedPath);
  if (!asset) throw createMmdError(`Unknown MMD static asset: ${normalizedPath}`, 404);
  return { ...asset };
};

const createStaticMmdResourceProfile = () => ({
  resourceId: STATIC_MMD_RELEASE.resourceId,
  modelType: 'pmx',
  modelUrl: `${STATIC_MMD_PROXY_PREFIX}${STATIC_MMD_RELEASE.modelPath}`,
  motionResourceId: STATIC_MMD_RELEASE.motionResourceId,
  motionUrl: `${STATIC_MMD_PROXY_PREFIX}${STATIC_MMD_RELEASE.motionPath}`,
  playMode: STATIC_MMD_RELEASE.playMode,
  version: STATIC_MMD_RELEASE.version,
});

const resolveStaticMmdSourceAssetUrls = async (sourceBaseUrl, relativePath, { lookup = dns.lookup } = {}) => {
  const source = new URL(sourceBaseUrl);
  if (source.protocol !== 'http:' || source.username || source.password || source.search || source.hash
    || !source.pathname.endsWith('/')) {
    throw createMmdError('MMD static release source is invalid', 502);
  }
  source.pathname = `${source.pathname}${relativePath}`;
  const hostname = source.hostname.toLowerCase();
  if (net.isIP(hostname) === 4) return [source.toString()];

  const resolvedAddresses = await lookup(hostname, { all: true, family: 4, verbatim: false });
  const addresses = (Array.isArray(resolvedAddresses) ? resolvedAddresses : [resolvedAddresses])
    .map((entry) => entry?.address)
    .filter((address) => address && net.isIP(address) === 4);
  const uniqueAddresses = [...new Set(addresses)];
  if (uniqueAddresses.length === 0) {
    throw createMmdError(`MMD static release has no IPv4 address: ${hostname}`, 502);
  }
  return uniqueAddresses.map((address) => {
    const resolvedSource = new URL(source);
    resolvedSource.hostname = address;
    return resolvedSource.toString();
  });
};

const resolveStaticMmdAssetUrl = async (relativePath, { lookup = dns.lookup } = {}) => {
  const asset = resolveStaticMmdAsset(relativePath);
  const sourceBaseUrl = `http://${STATIC_MMD_RELEASE.host}${STATIC_MMD_RELEASE.publicPath}`;
  return (await resolveStaticMmdSourceAssetUrls(sourceBaseUrl, asset.path, { lookup }))[0];
};

const requestFetch = async (target, { timeoutMs = STATIC_MMD_TIMEOUT_MS, headers = {}, redirect = 'manual' } = {}) => {
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  const response = await fetch(target, {
    headers,
    redirect,
    ...(signal ? { signal } : {}),
  });
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: response.body && typeof Readable.fromWeb === 'function' ? Readable.fromWeb(response.body) : null,
  };
};

const getResponseHeader = (headers, name) => {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] || headers[name.toLowerCase()] || null;
};

const asNodeReadable = (stream) => {
  if (!stream) return null;
  if (typeof stream.on === 'function') return stream;
  if (typeof Readable.fromWeb === 'function' && typeof stream.getReader === 'function') return Readable.fromWeb(stream);
  return null;
};

const discardStaticMmdResponse = async (response) => {
  const body = response?.body || response;
  if (body && typeof body.destroy === 'function') {
    body.destroy();
    return;
  }
  if (body && typeof body.cancel === 'function') {
    try {
      await body.cancel();
    } catch (error) {
      // 已失败的上游响应无需阻断下一个固定来源。
    }
  }
};

const fetchAndValidateStaticMmdAsset = async ({ asset, sourceUrl, request }) => {
  let response;
  try {
    response = await request(sourceUrl, {
      timeoutMs: STATIC_MMD_TIMEOUT_MS,
      redirect: 'manual',
      headers: {
        Accept: `${asset.contentType}, application/octet-stream;q=0.9, */*;q=0.8`,
        'User-Agent': 'AASC-MMD-Static-Proxy/1.0',
      },
    });
    const statusCode = Number(response?.statusCode ?? response?.status);
    if (statusCode !== 200) {
      throw createMmdError(`MMD static asset upstream returned HTTP ${statusCode || 'unknown'}`, 502);
    }
    const contentLength = getResponseHeader(response.headers, 'content-length');
    if (!/^\d+$/u.test(String(contentLength || '')) || Number(contentLength) !== asset.size) {
      throw createMmdError(`MMD static asset Content-Length is invalid: ${asset.path}`, 502);
    }
    const stream = asNodeReadable(response.body || response);
    if (!stream) throw createMmdError(`MMD static asset response has no body: ${asset.path}`, 502);

    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > asset.size) {
        stream.destroy?.();
        throw createMmdError(`MMD static asset exceeds declared size: ${asset.path}`, 502);
      }
      chunks.push(buffer);
    }
    if (total !== asset.size) {
      throw createMmdError(`MMD static asset size is incomplete: ${asset.path}`, 502);
    }
    const content = Buffer.concat(chunks, total);
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    if (digest !== asset.sha256) {
      throw createMmdError(`MMD static asset checksum mismatch: ${asset.path}`, 502);
    }
    return { content, contentType: asset.contentType, sourceUrl };
  } catch (error) {
    await discardStaticMmdResponse(response);
    throw error;
  }
};

const requestStaticMmdAsset = async ({ relativePath, lookup = dns.lookup, request = requestFetch } = {}) => {
  const asset = resolveStaticMmdAsset(relativePath);
  const sourceErrors = [];
  for (const sourceBaseUrl of STATIC_MMD_SOURCE_BASE_URLS) {
    let sourceUrls;
    try {
      sourceUrls = await resolveStaticMmdSourceAssetUrls(sourceBaseUrl, asset.path, { lookup });
    } catch (error) {
      sourceErrors.push(`${sourceBaseUrl}: ${error.message}`);
      continue;
    }
    for (const sourceUrl of sourceUrls) {
      try {
        return await fetchAndValidateStaticMmdAsset({ asset, sourceUrl, request });
      } catch (error) {
        sourceErrors.push(`${new URL(sourceUrl).origin}: ${error.message}`);
      }
    }
  }
  throw createMmdError(`MMD static asset failed from all sources: ${sourceErrors.join('; ')}`, 502);
};

const normalizeManifestPath = (value, label) => {
  if (typeof value !== 'string' || !value || value.includes('\\')) {
    throw createMmdError(`${label} must be a relative POSIX path`, 503);
  }
  const segments = value.split('/');
  if (segments.includes('..') || segments.includes('.') || value.startsWith('/') || /^[A-Za-z]:/u.test(value) || !value.startsWith('mmd/')) {
    throw createMmdError(`${label} contains an unsafe path`, 503);
  }
  return value;
};

const ensureRegularFile = async (modelRoot, relativePath) => {
  const root = path.resolve(modelRoot);
  const absolutePath = path.resolve(root, ...relativePath.split('/'));
  const relativeToRoot = path.relative(root, absolutePath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw createMmdError(`MMD resource escapes model root: ${relativePath}`, 503);
  }
  let stats;
  try {
    stats = await fs.lstat(absolutePath);
  } catch (error) {
    throw createMmdError(`Declared MMD file is missing: ${relativePath}`, 503);
  }
  if (!stats.isFile()) {
    throw createMmdError(`Declared MMD file is not a regular file: ${relativePath}`, 503);
  }
  return absolutePath;
};

const validateResource = async (resource, modelRoot) => {
  if (!resource || typeof resource !== 'object' || !RESOURCE_ID_PATTERN.test(resource.resourceId || '')) {
    throw createMmdError('MMD resourceId is invalid', 503);
  }
  if (resource.modelType !== 'pmx') {
    throw createMmdError('MMD modelType must be pmx', 503);
  }
  if (resource.playMode !== 'loop' && resource.playMode !== 'once') {
    throw createMmdError('MMD playMode must be loop or once', 503);
  }
  if (!RESOURCE_ID_PATTERN.test(resource.motionResourceId || '')) {
    throw createMmdError('MMD motionResourceId is invalid', 503);
  }
  if (typeof resource.version !== 'string' || !resource.version) {
    throw createMmdError('MMD resource version is invalid', 503);
  }
  const modelPath = normalizeManifestPath(resource.modelPath, 'modelPath');
  const motionPath = normalizeManifestPath(resource.motionPath, 'motionPath');
  if (!modelPath.toLowerCase().endsWith('.pmx') || !motionPath.toLowerCase().endsWith('.vmd')) {
    throw createMmdError('MMD modelPath or motionPath has an invalid extension', 503);
  }
  if (!Array.isArray(resource.files) || resource.files.length === 0) {
    throw createMmdError('MMD resource files must be a non-empty array', 503);
  }
  const declaredPaths = new Set();
  for (const file of resource.files) {
    const filePath = normalizeManifestPath(file?.path, 'MMD file path');
    if (declaredPaths.has(filePath) || !Number.isInteger(file?.size) || file.size < 0 || !SHA256_PATTERN.test(file?.sha256 || '')) {
      throw createMmdError(`MMD file declaration is invalid: ${filePath}`, 503);
    }
    declaredPaths.add(filePath);
    const absolutePath = await ensureRegularFile(modelRoot, filePath);
    const stats = await fs.stat(absolutePath);
    if (stats.size !== file.size) {
      throw createMmdError(`MMD file size does not match manifest: ${filePath}`, 503);
    }
    const digest = crypto.createHash('sha256').update(await fs.readFile(absolutePath)).digest('hex');
    if (digest !== file.sha256) {
      throw createMmdError(`MMD file checksum does not match manifest: ${filePath}`, 503);
    }
  }
  if (!declaredPaths.has(modelPath) || !declaredPaths.has(motionPath)) {
    throw createMmdError('MMD model and motion must be declared in files', 503);
  }
  return resource;
};

const loadMmdResourceManifest = async ({ modelRoot } = {}) => {
  if (typeof modelRoot !== 'string' || !modelRoot) {
    throw createMmdError('MMD model root is required', 503);
  }
  const manifestPath = path.join(modelRoot, MMD_MANIFEST_RELATIVE_PATH);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const missingManifestError = createMmdError('MMD manifest is missing', 503);
      missingManifestError.code = 'MMD_MANIFEST_MISSING';
      throw missingManifestError;
    }
    throw createMmdError(`Unable to load MMD manifest: ${error.message}`, 503);
  }
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.resources) || manifest.resources.length === 0) {
    throw createMmdError('MMD manifest schema is invalid', 503);
  }
  const resourceIds = new Set();
  for (const resource of manifest.resources) {
    await validateResource(resource, modelRoot);
    if (resourceIds.has(resource.resourceId)) {
      throw createMmdError(`Duplicate MMD resourceId: ${resource.resourceId}`, 503);
    }
    resourceIds.add(resource.resourceId);
  }
  return manifest;
};

const resolveMmdResource = (resourceId, { manifest } = {}) => {
  const resource = manifest?.resources?.find((entry) => entry.resourceId === resourceId);
  if (!resource) {
    throw createMmdError(`Unknown MMD resource: ${resourceId}`, 404);
  }
  return resource;
};

const createSameOriginModelUrl = (basePath, relativePath) => {
  if (typeof basePath !== 'string' || !basePath.startsWith('/') || basePath.startsWith('//') || basePath.includes('://')) {
    throw createMmdError('MMD base path must be same-origin', 503);
  }
  return `${basePath.replace(/\/+$/u, '')}/${relativePath.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;
};

const createMmdResourceProfile = (resource, { basePath = '/models' } = {}) => {
  if (!resource
    || resource.modelType !== 'pmx'
    || (resource.playMode !== 'loop' && resource.playMode !== 'once')) {
    throw createMmdError('MMD resource profile is invalid', 503);
  }
  const modelPath = normalizeManifestPath(resource.modelPath, 'modelPath');
  const motionPath = normalizeManifestPath(resource.motionPath, 'motionPath');
  return {
    resourceId: resource.resourceId,
    modelType: resource.modelType,
    modelUrl: createSameOriginModelUrl(basePath, modelPath),
    motionResourceId: resource.motionResourceId,
    motionUrl: createSameOriginModelUrl(basePath, motionPath),
    playMode: resource.playMode,
    version: resource.version,
  };
};

const loadPreferredMmdResources = async ({ modelRoot } = {}) => {
  try {
    const manifest = await loadMmdResourceManifest({ modelRoot });
    return manifest.resources.map((resource) => createMmdResourceProfile(resource));
  } catch (error) {
    if (error?.code === 'MMD_MANIFEST_MISSING') return [createStaticMmdResourceProfile()];
    throw error;
  }
};

module.exports = {
  MMD_MANIFEST_RELATIVE_PATH,
  STATIC_MMD_RELEASE,
  createStaticMmdResourceProfile,
  createMmdResourceProfile,
  loadMmdResourceManifest,
  loadPreferredMmdResources,
  requestStaticMmdAsset,
  resolveStaticMmdAsset,
  resolveStaticMmdAssetUrl,
  resolveMmdResource,
};
