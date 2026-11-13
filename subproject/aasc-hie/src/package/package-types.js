export const PACKAGE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export const MUTATION_OPERATIONS = Object.freeze(['add', 'replace', 'remove']);

export const MUTABLE_PACKAGE_SECTIONS = Object.freeze([
  'metadata',
  'scenarios',
  'goals',
  'states',
  'flows',
  'navmeshes',
  'assets',
  'sensors',
  'clock',
  'rules',
  'alerts',
  'simulation',
  'priorities',
]);

export class PackageRevisionConflict extends Error {
  constructor(packageId, expected, actual) {
    super(`package ${packageId} revision conflict: baseRevision ${expected} does not match current revision ${actual}`);
    this.name = 'PackageRevisionConflict';
    this.code = 'revision-conflict';
    this.packageId = packageId;
    this.expected = expected;
    this.actual = actual;
  }
}

export const isObject = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const cloneJson = (value) => JSON.parse(JSON.stringify(value));

export const assertPackageId = (packageId) => {
  if (typeof packageId !== 'string' || !PACKAGE_ID_PATTERN.test(packageId)
    || packageId === '.' || packageId === '..') {
    throw new Error(`invalid packageId: ${String(packageId)}`);
  }
  return packageId;
};

export const assertRevisionNumber = (revision, field = 'revision') => {
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return revision;
};

const decodePointerToken = (token) => {
  if (token.includes('~') && !/^(?:[^~]|~0|~1)*$/.test(token)) {
    throw new Error('invalid JSON Pointer escape');
  }
  const decoded = token.replace(/~1/g, '/').replace(/~0/g, '~');
  if (decoded === '__proto__' || decoded === 'prototype' || decoded === 'constructor'
    || decoded === '.' || decoded === '..' || decoded.includes('\\')) {
    throw new Error(`unsafe JSON Pointer path segment: ${decoded}`);
  }
  return decoded;
};

export const pointerSegments = (path) => {
  if (typeof path !== 'string' || !path.startsWith('/') || path === '/') {
    throw new Error('mutation path must be a non-empty JSON Pointer');
  }
  const segments = path.slice(1).split('/').map(decodePointerToken);
  if (!MUTABLE_PACKAGE_SECTIONS.includes(segments[0])) {
    throw new Error(`unsafe mutation path: ${path}`);
  }
  if (segments[0] === 'metadata' && ['id', 'revision', 'sourcePath'].includes(segments[1])) {
    throw new Error(`unsafe mutation path: ${path}`);
  }
  return segments;
};

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const arrayIndex = (value, length, allowAppend = false) => {
  if (allowAppend && value === '-') return length;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`invalid array index in JSON Pointer: ${value}`);
  }
  const index = Number(value);
  if (!Number.isSafeInteger(index) || index > length || (!allowAppend && index === length)) {
    throw new Error(`array index out of bounds in JSON Pointer: ${value}`);
  }
  return index;
};

const parentFor = (root, segments) => {
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(parent)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(segment) || Number(segment) >= parent.length) {
        throw new Error(`JSON Pointer parent does not exist: ${segments.join('/')}`);
      }
      parent = parent[Number(segment)];
    }
    else if (isObject(parent) && own(parent, segment)) {
      parent = parent[segment];
    }
    else {
      throw new Error(`JSON Pointer parent does not exist: ${segments.join('/')}`);
    }
    if (!Array.isArray(parent) && !isObject(parent)) {
      throw new Error(`JSON Pointer parent is not writable: ${segments.join('/')}`);
    }
  }
  return parent;
};

export const applyMutationOperations = (packageData, operations) => {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('operations must be a non-empty array');
  }
  const result = cloneJson(packageData);
  for (const operation of operations) {
    if (!isObject(operation) || !MUTATION_OPERATIONS.includes(operation.op)) {
      throw new Error('operation must use one of: add, replace, remove');
    }
    if (Object.keys(operation).some((key) => !['op', 'path', 'value'].includes(key))) {
      throw new Error('operation contains unsupported fields');
    }
    const segments = pointerSegments(operation.path);
    if (operation.op !== 'remove' && operation.value === undefined) {
      throw new Error(`${operation.op} operation requires value`);
    }
    const parent = parentFor(result, segments);
    const key = segments.at(-1);
    if (Array.isArray(parent)) {
      const index = arrayIndex(key, parent.length, operation.op === 'add');
      if (operation.op === 'add') parent.splice(index, 0, cloneJson(operation.value));
      else if (index >= parent.length) throw new Error(`JSON Pointer target does not exist: ${operation.path}`);
      else if (operation.op === 'replace') parent[index] = cloneJson(operation.value);
      else parent.splice(index, 1);
    }
    else if (isObject(parent)) {
      if (operation.op === 'replace' && !own(parent, key)) {
        throw new Error(`JSON Pointer target does not exist: ${operation.path}`);
      }
      if (operation.op === 'remove' && !own(parent, key)) {
        throw new Error(`JSON Pointer target does not exist: ${operation.path}`);
      }
      if (operation.op === 'remove') delete parent[key];
      else parent[key] = cloneJson(operation.value);
    }
    else {
      throw new Error(`JSON Pointer parent is not writable: ${operation.path}`);
    }
  }
  return result;
};

export const normalizeRevisionMetadata = (metadata = {}, options = {}) => {
  if (!isObject(metadata)) throw new Error('revision metadata must be an object');
  const author = metadata.author;
  if (!isObject(author)
    || typeof author.kind !== 'string' || !author.kind.trim()
    || typeof author.name !== 'string' || !author.name.trim()) {
    throw new Error('author.kind and author.name are required');
  }
  const normalized = {
    ...cloneJson(metadata),
    author: { ...cloneJson(author), kind: author.kind.trim(), name: author.name.trim() },
  };
  if (options.requireProvenance && !isObject(normalized.source)) {
    throw new Error('source provenance is required');
  }
  if (normalized.source !== undefined) {
    if (!isObject(normalized.source)) throw new Error('source must be an object');
    if (options.requireProvenance && typeof normalized.source.url !== 'string') {
      throw new Error('source.url provenance is required');
    }
    if (normalized.source.url !== undefined) {
      if (typeof normalized.source.url !== 'string') throw new Error('source.url must be a URL');
      let url;
      try { url = new URL(normalized.source.url); } catch { throw new Error('source.url must be a URL'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('source.url must be an HTTP(S) URL');
    }
    if (options.requireProvenance
      && (typeof normalized.source.version !== 'string' || !normalized.source.version.trim())) {
      throw new Error('source.version provenance is required');
    }
    if (normalized.source.version !== undefined
      && (typeof normalized.source.version !== 'string' || !normalized.source.version.trim())) {
      throw new Error('source.version must be a non-empty string');
    }
  }
  return normalized;
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

export const assertCanonicalRevisionEnvelope = (revision, packageId) => {
  if (!isObject(revision)) throw new Error('revision envelope must be an object');
  if (revision.packageId !== packageId) throw new Error('revision envelope packageId does not match package');
  assertRevisionNumber(revision.revision);
  assertRevisionNumber(revision.baseRevision, 'baseRevision');
  if (revision.revision !== revision.baseRevision + 1) {
    throw new Error('revision envelope has invalid baseRevision lineage');
  }
  if (!isObject(revision.package) || revision.package.metadata?.id !== packageId
    || revision.package.revision !== revision.revision) {
    throw new Error('revision envelope package identity is invalid');
  }
  if (revision.data !== undefined
    && JSON.stringify(canonicalize(revision.data)) !== JSON.stringify(canonicalize(revision.package))) {
    throw new Error('revision envelope data does not match package');
  }
  const normalizedMetadata = normalizeRevisionMetadata(revision.metadata, { requireProvenance: true });
  if (JSON.stringify(canonicalize(normalizedMetadata))
    !== JSON.stringify(canonicalize(revision.metadata))) {
    throw new Error('revision envelope metadata is not normalized');
  }
  if (typeof revision.createdAt !== 'string' || !Number.isFinite(Date.parse(revision.createdAt))) {
    throw new Error('revision envelope createdAt is required');
  }
  return revision;
};
