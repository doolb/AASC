import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createPreprocessor } from '../core/preprocess.mjs';
import { sha256 } from '../core/benchmark-common.mjs';

// 当前Python参考先单独生成；本CLI只CPU对比，不加载ONNX，不覆盖既有报告。
const [casePath, referenceDir, reportPath] = process.argv.slice(2);
if (!casePath || !referenceDir || !reportPath) throw new Error('用法：node app/test-preprocess.mjs cases.json reference-dir new-report.json');
const cases = JSON.parse(await readFile(casePath, 'utf8'));
const reference = JSON.parse(await readFile(path.join(referenceDir, 'manifest.json'), 'utf8'));
const prepare = await createPreprocessor();
function decode(bytes, dtype) {
  if (dtype === 'uint8') return Uint8Array.from(bytes);
  const size = dtype === 'float64' ? 8 : 4;
  if (bytes.length % size) throw new Error('参考数值文件长度不一致');
  return (dtype === 'float64' ? Float64Array : Float32Array).from({ length: bytes.length / size }, (_, index) =>
    size === 8 ? bytes.readDoubleLE(index * 8) : bytes.readFloatLE(index * 4));
}
function errorStats(expected, actual) {
  if (expected.length !== actual.length) throw new Error('比较维度不一致');
  let maxAbs = 0;
  let sumSquares = 0;
  let different = 0;
  for (let index = 0; index < expected.length; index += 1) {
    if (!Number.isFinite(expected[index]) || !Number.isFinite(actual[index])) throw new Error('比较包含非有限值');
    const delta = Math.abs(expected[index] - actual[index]);
    if (delta) different += 1;
    maxAbs = Math.max(maxAbs, delta);
    sumSquares += delta * delta;
  }
  return { maxAbs, rms: Math.sqrt(sumSquares / expected.length), different, scalars: expected.length };
}
const records = [];
for (const input of cases) {
  const old = reference.records.find((entry) => entry.name === input.name);
  if (!old) throw new Error('参考缺少样本：' + input.name);
  const encoded = await readFile(input.imagePath);
  const start = performance.now();
  try {
    const actual = await prepare(encoded, input.bbox, { stages: true });
    const elapsedMs = performance.now() - start;
    if (!old.ok) { records.push({ name: input.name, referenceOk: false, nodeOk: true, unexpectedAcceptance: true }); continue; }
    const inputErrors = {};
    for (const [name, values] of Object.entries(actual.inputs)) {
      const data = await readFile(path.join(referenceDir, input.name, name + '.bin'));
      inputErrors[name] = { ...errorStats(decode(data, 'float32'), values), sameSha256: old.inputs[name].sha256 === sha256(Buffer.from(values.buffer, values.byteOffset, values.byteLength)) };
    }
    const stageErrors = {};
    for (const [name, values] of Object.entries(actual.stages)) {
      if (!old.stages[name]) continue;
      const data = await readFile(path.join(referenceDir, input.name, name + '.bin'));
      stageErrors[name] = errorStats(decode(data, old.stages[name].dtype), values);
    }
    records.push({ name: input.name, referenceOk: true, nodeOk: true, imageSha256: sha256(encoded),
      elapsedMs, inputErrors, stageErrors, geometry: actual.stages.geometry,
      preprocessing: actual.metadata.preprocessing, metadataEqual: JSON.stringify(old.metadata) === JSON.stringify({
        imageSize: actual.metadata.imageSize, boxXYXY: actual.metadata.boxXYXY, bboxSource: actual.metadata.bboxSource }) });
  } catch (error) {
    records.push({ name: input.name, referenceOk: old.ok, nodeOk: false, code: error.code ?? 'unknown', message: error.message });
  }
}
const report = { scope: '同bytes/box的当前Python原prepare_image CPU参考 vs Node decode/Gaussian/WASM affine/FP32；不是GPU精度或识别真值',
  createdAt: new Date().toISOString(), referenceVersions: reference.versions, sourceServiceSha256: reference.sourceServiceSha256,
  opencvVersionDifference: '原cv2 4.13 vs OpenCV.js 4.12，差异逐case记录，不以选库宣称等价', records };
await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ report: path.resolve(reportPath), samples: records.length,
  maxInputError: Math.max(...records.filter((entry) => entry.inputErrors).map((entry) => entry.inputErrors.img.maxAbs)),
  failed: records.filter((entry) => entry.referenceOk !== entry.nodeOk).map((entry) => entry.name) }));
if (records.some((entry) => entry.referenceOk !== entry.nodeOk)) process.exitCode = 1;
