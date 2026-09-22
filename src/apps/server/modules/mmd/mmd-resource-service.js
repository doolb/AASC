const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MMD_MANIFEST_RELATIVE_PATH = path.join('mmd', 'manifest.json');
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const createMmdError = (message, statusCode = 503) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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
  if (resource.playMode !== 'once') {
    throw createMmdError('MMD playMode must be once', 503);
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
  if (!resource || resource.modelType !== 'pmx' || resource.playMode !== 'once') {
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

module.exports = {
  MMD_MANIFEST_RELATIVE_PATH,
  createMmdResourceProfile,
  loadMmdResourceManifest,
  resolveMmdResource,
};
