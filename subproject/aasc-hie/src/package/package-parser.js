import { Buffer } from 'node:buffer';
import {
  PACKAGE_ID_PATTERN,
  cloneJson,
  isObject,
} from './package-types.js';

const FENCE = String.fromCharCode(96).repeat(3);
const NAVIGATION_BLOCK = new RegExp(`${FENCE}navigation-json[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?${FENCE}`, 'gi');
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\((data:image\/[A-Za-z0-9.+-]+;base64,[^)]+)\)/gi;

const fail = (sourcePath, message) => {
  throw new Error(`${sourcePath}: ${message}`);
};

const requiredId = (value, field, sourcePath) => {
  if (typeof value !== 'string' || !value.trim() || !PACKAGE_ID_PATTERN.test(value.trim())
    || value.trim() === '.' || value.trim() === '..') {
    fail(sourcePath, `invalid ${field}: ${String(value)}`);
  }
  return value.trim();
};

const arrayField = (object, field, sourcePath) => {
  if (object[field] === undefined) return [];
  if (!Array.isArray(object[field])) fail(sourcePath, `${field} must be an array`);
  return object[field];
};

const relativePath = (value, field, sourcePath) => {
  if (typeof value !== 'string' || !value.trim()
    || value.startsWith('/') || value.includes('\\')
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(value)) {
    fail(sourcePath, `invalid ${field}`);
  }
  return value;
};

const validBase64 = (dataBase64) => {
  const normalized = dataBase64.replace(/\s/g, '');
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return false;
  const decoded = Buffer.from(normalized, 'base64');
  return decoded.length > 0 && decoded.toString('base64') === normalized;
};

const parseAssets = (markdown, sourcePath) => {
  const assets = [];
  for (const match of markdown.matchAll(MARKDOWN_IMAGE)) {
    const alt = match[1].trim();
    const dataUri = match[2];
    const dataBase64 = dataUri.slice(dataUri.indexOf(',') + 1);
    if (!validBase64(dataBase64)) fail(sourcePath, 'invalid base64 image asset');
    const [idToken, ...description] = alt.split(/\s+/).filter(Boolean);
    const id = requiredId(idToken || `image-${assets.length + 1}`, 'asset.id', sourcePath);
    assets.push({
      id,
      ...(alt ? { alt } : {}),
      ...(description.length ? { description: description.join(' ') } : {}),
      dataUri,
      mimeType: dataUri.slice(5, dataUri.indexOf(';')),
      dataBase64: dataBase64.replace(/\s/g, ''),
    });
  }
  return assets;
};

const normalizeEntries = (entries, field, headingScenario, sourcePath) => entries.map((entry) => {
  if (!isObject(entry)) fail(sourcePath, `${field} item must be an object`);
  const normalized = cloneJson(entry);
  normalized.id = requiredId(normalized.id, `${field}.id`, sourcePath);
  if (normalized.scenarioId === undefined) {
    if (typeof normalized.scenario === 'string' && normalized.scenario.trim()) {
      normalized.scenarioId = normalized.scenario.trim();
    }
    else if (headingScenario) {
      normalized.scenarioId = headingScenario;
    }
  }
  if (field === 'flows') {
    normalized.steps = (normalized.steps ?? []).map((step, index) => {
      const value = cloneJson(step);
      if (!isObject(value)) fail(sourcePath, 'flow step item must be an object');
      value.id ??= `${normalized.id}:step-${index}`;
      value.kind ??= 'action';
      if (Array.isArray(value.candidates)) {
        value.candidates = value.candidates.map((candidate, candidateIndex) => ({
          ...cloneJson(candidate),
          id: candidate.id ?? `${value.id}:step-${candidateIndex}`,
          kind: candidate.kind ?? 'action',
        }));
      }
      return value;
    });
  }
  if (field === 'states' && normalized.topmost && Array.isArray(normalized.uis)
    && !normalized.uis.includes(normalized.topmost)) {
    fail(sourcePath, 'state.topmost must be included in state.uis');
  }
  if (field === 'navmeshes') normalized.file = relativePath(normalized.file, 'navmesh.file', sourcePath);
  return normalized;
});

const assertUnique = (values, field, sourcePath) => {
  const ids = new Set();
  for (const value of values) {
    if (ids.has(value.id)) fail(sourcePath, `duplicate ${field} id: ${value.id}`);
    ids.add(value.id);
  }
};

export const parseNavigationPackage = (markdown, filePath = '(inline package)') => {
  if (typeof markdown !== 'string') fail(filePath, 'markdown must be a string');
  const blocks = [...markdown.matchAll(NAVIGATION_BLOCK)];
  if (!blocks.length) fail(filePath, 'navigation-json block is required');

  const result = {
    sourcePath: filePath,
    metadata: undefined,
    scenarios: [],
    goals: [],
    states: [],
    flows: [],
    navmeshes: [],
    assets: parseAssets(markdown, filePath),
  };
  for (const blockMatch of blocks) {
    let block;
    try { block = JSON.parse(blockMatch[1] ?? ''); }
    catch (error) { fail(filePath, `invalid navigation-json block: ${error.message}`); }
    if (!isObject(block)) fail(filePath, 'navigation-json block must be an object');
    const headingMatches = [...markdown.slice(0, blockMatch.index ?? 0)
      .matchAll(/^#{1,6}[ \t]+Scenario:[ \t]*([A-Za-z0-9._:-]+)[ \t]*$/gim)];
    const headingScenario = headingMatches.at(-1)?.[1];
    const blockMetadata = block.metadata === undefined ? {} : block.metadata;
    if (!isObject(blockMetadata)) fail(filePath, 'metadata must be an object');
    const packageId = blockMetadata.id ?? block.packageId;
    if (packageId !== undefined) {
      const id = requiredId(packageId, 'package metadata.id', filePath);
      if (result.metadata && result.metadata.id !== id) fail(filePath, 'metadata.id differs between blocks');
      result.metadata ??= { ...cloneJson(blockMetadata), id };
      result.metadata = { ...result.metadata, ...cloneJson(blockMetadata), id };
    }
    for (const field of ['scenarios', 'goals', 'states', 'flows', 'navmeshes']) {
      result[field].push(...normalizeEntries(arrayField(block, field, filePath), field, headingScenario, filePath));
    }
    for (const [key, value] of Object.entries(block)) {
      if (!['metadata', 'packageId', 'scenarios', 'goals', 'states', 'flows', 'navmeshes'].includes(key)) {
        result[key] = cloneJson(value);
      }
    }
  }
  if (!result.metadata?.id) fail(filePath, 'package metadata.id is required');
  for (const field of ['scenarios', 'goals', 'states', 'flows', 'navmeshes', 'assets']) {
    assertUnique(result[field], field.slice(0, -1), filePath);
  }
  return result;
};
