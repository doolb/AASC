import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

// 复用阶段A的固定四输入/九输出FP32合同；原图转换仅在preprocess模块，不改变模型数学。
export const INPUT_SHAPES = Object.freeze({
  img: [1, 3, 256, 192],
  box_center: [1, 2],
  box_size: [1],
  img_size: [1, 2],
});
export const OUTPUT_SHAPES = Object.freeze({
  xyz: [1, 25, 3],
  xy: [1, 25, 2],
  rotations24: [1, 24, 3, 3],
  betas10: [1, 10],
  predCam: [1, 3],
  cameraTranslation: [1, 3],
  cameraDepth: [1, 25],
  focalLengthPx: [1],
  principalPointPx: [1, 2],
});

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractError';
  }
}

export function ensure(condition, message) {
  if (!condition) throw new ContractError(message);
}

export function shapeCount(shape, label) {
  ensure(Array.isArray(shape) && shape.length > 0 &&
    shape.every((dim) => Number.isSafeInteger(dim) && dim > 0), `${label}: shape 非正整数数组`);
  const count = shape.reduce((a, b) => a * b, 1);
  ensure(Number.isSafeInteger(count) && count <= 10_000_000, `${label}: 元素数超限`);
  return count;
}

export function sameShape(actual, expected, label) {
  shapeCount(actual, label);
  ensure(Array.isArray(expected) && actual.length === expected.length &&
    actual.every((dim, index) => dim === expected[index]), `${label}: 维度不符合合同`);
}

export function exactKeys(value, reference, label) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), `${label}: 应为对象`);
  const names = Object.keys(value).sort();
  ensure(JSON.stringify(names) === JSON.stringify(Object.keys(reference).sort()), `${label}: 名称与合同不一致`);
}

export function validSha(value, label) {
  ensure(typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value), `${label}: SHA-256 格式错误`);
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function validateOutputSet(outputs, shapes = OUTPUT_SHAPES, label = 'outputs') {
  exactKeys(outputs, shapes, label);
  for (const [key, shape] of Object.entries(shapes)) {
    const record = outputs[key];
    ensure(record && typeof record === 'object' && !Array.isArray(record), `${label}.${key}: 缺少张量`);
    sameShape(record.dims, shape, `${label}.${key}`);
    ensure(Array.isArray(record.data) && record.data.length === shapeCount(shape, key), `${label}.${key}: 数值长度错误`);
    ensure(record.data.every((value) => typeof value === 'number' && Number.isFinite(value)), `${label}.${key}: 含非有限数值`);
  }
  ensure(outputs.cameraDepth.data.every((depth) => depth > 0), `${label}: cameraDepth 必须全部为正`);
  ensure(outputs.cameraTranslation.data[2] > 0, `${label}: cameraTranslation.z 必须为正`);
  ensure(outputs.focalLengthPx.data[0] > 0, `${label}: 焦距必须为正`);
  return outputs;
}

export function validateManifest(manifest) {
  ensure(manifest?.schemaVersion === 1, 'manifest: schemaVersion 必须为 1');
  exactKeys(manifest.inputShapes, INPUT_SHAPES, 'manifest.inputShapes');
  exactKeys(manifest.outputShapes, OUTPUT_SHAPES, 'manifest.outputShapes');
  for (const [key, shape] of Object.entries(INPUT_SHAPES)) sameShape(manifest.inputShapes[key], shape, `manifest.inputShapes.${key}`);
  for (const [key, shape] of Object.entries(OUTPUT_SHAPES)) sameShape(manifest.outputShapes[key], shape, `manifest.outputShapes.${key}`);
  ensure(Array.isArray(manifest.samples) && manifest.samples.length > 0 && manifest.samples.length <= 100, 'manifest.samples: 数量无效');
  const names = new Set();
  for (const sample of manifest.samples) {
    ensure(typeof sample?.name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(sample.name) && !names.has(sample.name), 'manifest.samples: 样本名重复或格式错误');
    names.add(sample.name);
    ensure(typeof sample.label === 'string' && sample.label.length <= 160, `${sample.name}: label 无效`);
    const size = sample.imageSize;
    ensure((Array.isArray(size) && size.length === 2 && size.every((v) => Number.isSafeInteger(v) && v > 0)) ||
      (size && !Array.isArray(size) && Number.isSafeInteger(size.width) && size.width > 0 && Number.isSafeInteger(size.height) && size.height > 0), `${sample.name}: imageSize 无效`);
    ensure(Array.isArray(sample.boxXYXY) && sample.boxXYXY.length === 4 && sample.boxXYXY.every(Number.isFinite) &&
      sample.boxXYXY[2] > sample.boxXYXY[0] && sample.boxXYXY[3] > sample.boxXYXY[1], `${sample.name}: boxXYXY 无效`);
    validSha(sample.imageSha256, `${sample.name}.imageSha256`);
    exactKeys(sample.inputs, INPUT_SHAPES, `${sample.name}.inputs`);
    for (const [key, shape] of Object.entries(INPUT_SHAPES)) {
      const record = sample.inputs[key];
      ensure(record && typeof record === 'object' && typeof record.path === 'string', `${sample.name}.${key}: 路径无效`);
      sameShape(record.shape, shape, `${sample.name}.${key}`);
      validSha(record.sha256, `${sample.name}.${key}.sha256`);
    }
    ensure(typeof sample.referenceOutputs === 'string', `${sample.name}: referenceOutputs 缺失`);
  }
  return manifest;
}

// 文件及其实际指向均须位于 manifest 所在目录；校验路径时不输出宿主的绝对路径。
export async function fixtureFile(manifestPath, relative, label) {
  ensure(typeof relative === 'string' && relative.length > 0 && relative.length < 512 &&
    !path.isAbsolute(relative) && !relative.includes('\0') &&
    !relative.replaceAll('\\', '/').split('/').includes('..') &&
    !/^[a-zA-Z]:/.test(relative), `${label}: 必须为 fixture 内的相对路径`);
  const base = await realpath(path.dirname(manifestPath));
  const target = path.resolve(base, relative);
  const within = (file) => {
    const diff = path.relative(base, file);
    return diff !== '' && diff !== '..' && !diff.startsWith(`..${path.sep}`) && !path.isAbsolute(diff);
  };
  ensure(within(target), `${label}: 路径越出 fixture 目录`);
  const actual = await realpath(target);
  ensure(within(actual), `${label}: 链接越出 fixture 目录`);
  ensure((await stat(actual)).isFile(), `${label}: 非普通文件`);
  return actual;
}

export async function readJsonLimited(file, maxBytes, label) {
  ensure((await stat(file)).size <= maxBytes, `${label}: JSON 文件过大`);
  const bytes = await readFile(file);
  ensure(bytes.byteLength <= maxBytes, `${label}: JSON 文件过大`);
  try {
    return { json: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) };
  } catch {
    throw new ContractError(`${label}: JSON 格式错误`);
  }
}

export async function loadManifest(manifestPath) {
  const { json: manifest, sha256: digest } = await readJsonLimited(manifestPath, 1_000_000, 'manifest');
  validateManifest(manifest);
  return { manifest, sha256: digest };
}

// Buffer 往往来自池并可带未对齐 byteOffset；只允许小端原始 FP32，保证 data 为新的固定 baseData。
export function decodeFloat32(bytes, shape, digest, label) {
  const length = shapeCount(shape, label);
  ensure(bytes.byteLength === length * Float32Array.BYTES_PER_ELEMENT, `${label}: 输入字节长度错误`);
  validSha(digest, label);
  ensure(sha256(bytes).toLowerCase() === digest.toLowerCase(), `${label}: SHA-256 不匹配`);
  const values = new Float32Array(length);
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < length; i += 1) values[i] = dataView.getFloat32(i * 4, true);
  ensure(values.every(Number.isFinite), `${label}: 输入包含非有限数值`);
  return values;
}

export async function loadInputs(sample, manifestPath) {
  const inputs = {};
  for (const [key, shape] of Object.entries(INPUT_SHAPES)) {
    const record = sample.inputs[key];
    const file = await fixtureFile(manifestPath, record.path, `${sample.name}.${key}`);
    ensure((await stat(file)).size === shapeCount(shape, key) * 4, `${sample.name}.${key}: 输入字节长度错误`);
    inputs[key] = decodeFloat32(await readFile(file), shape, record.sha256, `${sample.name}.${key}`);
  }
  return inputs;
}

export async function loadReference(sample, manifestPath) {
  const file = await fixtureFile(manifestPath, sample.referenceOutputs, `${sample.name}.referenceOutputs`);
  const { json } = await readJsonLimited(file, 1_000_000, `${sample.name}.referenceOutputs`);
  ensure(json && json.outputs && Object.keys(json).every((key) => ['outputs', 'productionMaxAbs', 'source'].includes(key)), `${sample.name}: reference.json 包含未知字段或缺少 outputs`);
  // 原生参考保留零误差与来源证据；这些字段不参与模型输入。
  if (json.productionMaxAbs) {
    exactKeys(json.productionMaxAbs, OUTPUT_SHAPES, `${sample.name}.productionMaxAbs`);
    ensure(Object.values(json.productionMaxAbs).every((value) => Number.isFinite(value) && value === 0), `${sample.name}: 包装器未与原服务逐值等价`);
  }
  if (json.source !== undefined) ensure(typeof json.source === 'string', `${sample.name}: 来源必须为字符串`);
  return validateOutputSet(json.outputs, OUTPUT_SHAPES, `${sample.name}.reference`);
}

export function stats(numbers) {
  ensure(Array.isArray(numbers) && numbers.length > 0 && numbers.every((n) => Number.isFinite(n) && n >= 0), '统计数值无效');
  const sorted = numbers.toSorted((a, b) => a - b);
  const quantile = (fraction) => {
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  return { count: numbers.length, max: sorted.at(-1), rms: Math.sqrt(numbers.reduce((sum, n) => sum + n * n, 0) / numbers.length), p50: quantile(0.5), p95: quantile(0.95) };
}

export function safeError(error) {
  return error instanceof ContractError ? error.message : `操作失败（${typeof error?.code === 'string' ? error.code : 'native或I/O错误'}；已隐藏宿主路径及底层信息）`;
}
