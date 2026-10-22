import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import {
  INPUT_SHAPES, OUTPUT_SHAPES, decodeFloat32, fixtureFile, sha256, stats,
  validateManifest, validateOutputSet,
} from '../core/benchmark-common.mjs';
import { captureOutputs, inspectSession, nativeCapabilities, parseArgs as benchArgs } from './benchmark.mjs';
import { compareOutputs, matrixQuality, rotationErrors, verifyResult, comparisonMarkdown,
  parseArgs as compareArgs } from './compare-results.mjs';

// 测试伪代码映射：.src/framework/hmr2-node-onnx-benchmark.md 的“测试映射”；不加载 HMR/显卡。
const SHA = 'a'.repeat(64);

function fixtureSample() {
  return {
    name: 'toy', label: '仅结构测试', imageSize: [320, 240], boxXYXY: [1, 2, 50, 90], imageSha256: SHA,
    inputs: Object.fromEntries(Object.entries(INPUT_SHAPES).map(([key, shape]) =>
      [key, { path: `samples/toy/${key}.bin`, shape: [...shape], sha256: SHA }])),
    referenceOutputs: 'samples/toy/reference.json',
  };
}

function manifest() {
  return { schemaVersion: 1, inputShapes: INPUT_SHAPES, outputShapes: OUTPUT_SHAPES, samples: [fixtureSample()] };
}

function outputs() {
  const data = Object.fromEntries(Object.entries(OUTPUT_SHAPES).map(([key, dims]) =>
    [key, { dims: [...dims], data: Array(dims.reduce((a, b) => a * b, 1)).fill(0) }]));
  for (let i = 0; i < 24; i += 1) {
    for (let axis = 0; axis < 3; axis += 1) data.rotations24.data[i * 9 + axis * 3 + axis] = 1;
  }
  data.cameraDepth.data.fill(1);
  data.cameraTranslation.data[2] = 1;
  data.principalPointPx.data = [160, 120];
  data.focalLengthPx.data[0] = 1_000;
  return data;
}

// 无额外依赖地编码仅 Add 两个 FP32[1,2] 的小 ONNX protobuf，绝不导入真实多GB模型。
function toyOnnx() {
  const join = (...parts) => Buffer.concat(parts.map((part) => Buffer.from(part)));
  const integer = (number) => {
    const parts = [];
    let value = BigInt(number);
    do {
      const byte = Number(value & 0x7fn);
      value >>= 7n;
      parts.push(value ? byte | 0x80 : byte);
    } while (value);
    return Buffer.from(parts);
  };
  const scalar = (field, number) => join(integer(field * 8), integer(number));
  const bytes = (field, payload) => join(integer(field * 8 + 2), integer(payload.length), payload);
  const text = (field, value) => bytes(field, Buffer.from(value, 'utf8'));
  const shape = bytes(2, join(...[1, 2].map((dim) => bytes(1, scalar(1, dim)))));
  const tensorType = join(scalar(1, 1), shape);
  const valueInfo = (name) => join(text(1, name), bytes(2, bytes(1, tensorType)));
  const node = join(text(1, 'a'), text(1, 'b'), text(2, 'sum'), text(3, 'toy-add'), text(4, 'Add'));
  const graph = join(bytes(1, node), text(2, 'toy-CPU-only'),
    bytes(11, valueInfo('a')), bytes(11, valueInfo('b')), bytes(12, valueInfo('sum')));
  const opset = join(text(1, ''), scalar(2, 18));
  return join(scalar(1, 9), text(2, 'isolated-test'), bytes(7, graph), bytes(8, opset));
}

test('原始小端 FP32 校验池内非对齐 byteOffset，拷贝为独立固定 baseData', () => {
  const backing = Buffer.alloc(9);
  backing.writeFloatLE(1.5, 1);
  backing.writeFloatLE(-2.25, 5);
  const raw = backing.subarray(1, 9);
  assert.equal(raw.byteLength, 8);
  const copied = decodeFloat32(raw, [1, 2], sha256(raw), 'toy');
  assert.deepEqual([...copied], [1.5, -2.25]);
  backing.writeFloatLE(123, 1);
  assert.equal(copied[0], 1.5);
  assert.throws(() => decodeFloat32(raw, [1, 2], SHA, 'toy'), /SHA-256/);
  assert.throws(() => decodeFloat32(raw.subarray(0, 7), [1, 2], SHA, 'toy'), /字节长度/);
  const notFinite = Buffer.alloc(4);
  notFinite.writeFloatLE(Number.NaN);
  assert.throws(() => decodeFloat32(notFinite, [1], sha256(notFinite), 'toy'), /非有限/);
});

test('合同固定四输入九输出 batch1，拒绝错名/错形/非有限/非正深度', () => {
  validateManifest(manifest());
  const bad = manifest();
  bad.inputShapes = { ...bad.inputShapes, img: [1, 3, 256, 193] };
  assert.throws(() => validateManifest(bad), /维度/);
  const record = outputs();
  validateOutputSet(record);
  record.xyz.dims = [25, 3];
  assert.throws(() => validateOutputSet(record), /维度/);
  record.xyz.dims = [1, 25, 3];
  record.xy.data[0] = Number.POSITIVE_INFINITY;
  assert.throws(() => validateOutputSet(record), /非有限/);
  record.xy.data[0] = 0;
  record.cameraDepth.data[0] = 0;
  assert.throws(() => validateOutputSet(record), /正/);
});

test('fixture 路径拒绝越界与绝对路径，不读取任何外部路径', async () => {
  const manifestFile = path.resolve('fixtures/manifest.json');
  await assert.rejects(() => fixtureFile(manifestFile, '../outside.bin', 'toy'), /相对路径/);
  await assert.rejects(() => fixtureFile(manifestFile, 'C:\\private\\outside.bin', 'toy'), /相对路径/);
  await assert.rejects(() => fixtureFile(manifestFile, '..\\outside.bin', 'toy'), /相对路径/);
});

test('比较 XYZ 3D mm、XY px、rotation trace/正交/det 和全字段 flat abs', () => {
  const baseline = outputs();
  const changed = structuredClone(baseline);
  changed.xyz.data[0] = 0.001;
  changed.xy.data[0] = 3;
  // Z 轴旋转 90°，不假装组件差等于角误差。
  changed.rotations24.data.splice(0, 9, 0, -1, 0, 1, 0, 0, 0, 0, 1);
  changed.predCam.data[1] = 2;
  const comparison = compareOutputs(baseline, changed);
  assert.ok(Math.abs(comparison.xyz.pointEuclideanMm.max - 1) < 1e-8);
  assert.equal(comparison.xy.pointEuclideanPx.max, 3);
  assert.ok(Math.abs(comparison.rotations24.angleDeg.max - 90) < 1e-6);
  assert.equal(comparison.predCam.flatAbsolute.max, 2);
  assert.equal(comparison.rotations24.determinantAbsDeviationFromOne.candidate.max, 0);
  assert.equal(comparison.rotations24.orthogonalityFrobenius.candidate.max, 0);
  const notRotation = changed.rotations24.data.toSpliced(3, 1, 2);
  assert.equal(matrixQuality(notRotation, 0).determinantDeviation, 1);
  assert.ok(matrixQuality(notRotation, 0).orthogonalityFrobenius > 0);
  assert.equal(rotationErrors(baseline.rotations24.data, changed.rotations24.data).angleDeg.count, 24);
});

test('比较器需原始输出的每项维度、四 Tensor SHA，重复运行不是独立样本', () => {
  const frozen = manifest();
  const record = outputs();
  const sample = { ...fixtureSample(), inputSha256: Object.fromEntries(Object.keys(INPUT_SHAPES).map((key) => [key, SHA])),
    outputs: { firstRun: record, hotLast: structuredClone(record) }, timings: { firstRunMs: 1, hotRunsMs: [1, 2], hot: { p50Ms: 1.5, p95Ms: 1.95 } } };
  const result = { schemaVersion: 1, kind: 'node-onnx-benchmark', samples: [sample] };
  assert.equal(verifyResult(result, frozen, 'node').get('toy').name, 'toy');
  const wrong = structuredClone(result);
  wrong.samples[0].outputs.hotLast.xyz.dims = [25, 3];
  assert.throws(() => verifyResult(wrong, frozen, 'node'), /维度/);
  const differentInput = structuredClone(result);
  differentInput.samples[0].inputSha256.img = 'b'.repeat(64);
  assert.throws(() => verifyResult(differentInput, frozen, 'node'), /SHA/);
  assert.throws(() => verifyResult({ ...result, kind: 'node-onnx-diagnostic' }, frozen, 'node'), /不是可比对/);
  assert.equal(stats([1, 2, 3, 4]).p50, 2.5);
  assert.ok(comparisonMarkdown({ scope: { independentImageSamples: 3 }, comparisons: [] }).includes('独立样本：3'));
});

test('显式 DML/CPU CLI 参数不可伪装 CUDA；静态 provider 不等于实际模型分配', () => {
  assert.equal(benchArgs(['--provider', 'cpu']).provider, 'cpu');
  assert.equal(benchArgs([]).optimization, 'all');
  assert.equal(benchArgs(['--optimization', 'disabled']).optimization, 'disabled');
  assert.throws(() => benchArgs(['--optimization', 'unknown']), /all 或 disabled/);
  assert.throws(() => benchArgs(['--provider', 'cuda']), /dml 或 cpu/);
  assert.ok(compareArgs(['--node', 'tmp/node-report.json', '--out', 'tmp/report.md']).out.endsWith('.json'));
  assert.throws(() => compareArgs(['--node', '']), /--node/);
  const capability = nativeCapabilities();
  assert.equal(capability.api, 'listSupportedBackends');
  assert.ok(capability.backends.some((entry) => entry.name === 'cpu'));
  assert.match(capability.note, /不证明/);
  const metadata = (shapeMap) => Object.entries(shapeMap).map(([name, shape]) =>
    ({ name, isTensor: true, type: 'float32', shape: [...shape] }));
  const fake = { inputNames: Object.keys(INPUT_SHAPES), outputNames: Object.keys(OUTPUT_SHAPES),
    inputMetadata: metadata(INPUT_SHAPES), outputMetadata: metadata(OUTPUT_SHAPES) };
  assert.equal(inspectSession(fake).outputs.length, 9);
  fake.inputMetadata[0].type = 'float16';
  assert.throws(() => inspectSession(fake), /dtype/);
  const raw = Object.fromEntries(Object.entries(outputs()).map(([key, value]) =>
    [key, { type: 'float32', dims: value.dims, data: Float32Array.from(value.data) }]));
  assert.equal(captureOutputs(raw).xyz.data.length, 75);
  raw.cameraDepth.data[0] = -1;
  assert.throws(() => captureOutputs(raw), /正/);
});

test('稳定四元数相对角：90度、自身非严格正交底噪和微小角', () => {
  const baseline = outputs();
  const rotated = structuredClone(baseline);
  rotated.rotations24.data.splice(0, 9, 0, -1, 0, 1, 0, 0, 0, 0, 1);
  assert.ok(Math.abs(rotationErrors(baseline.rotations24.data, rotated.rotations24.data).normalizedQuaternionAngleDeg.max - 90) < 1e-8);
  const drift = structuredClone(baseline);
  drift.rotations24.data[0] = Math.fround(0.9999999);
  const same = rotationErrors(drift.rotations24.data, drift.rotations24.data);
  assert.equal(same.normalizedQuaternionAngleDeg.max, 0);
  assert.ok(same.angleDeg.max > 0);
  const small = structuredClone(baseline);
  const theta = 1e-6;
  small.rotations24.data.splice(0, 9, Math.cos(theta), -Math.sin(theta), 0, Math.sin(theta), Math.cos(theta), 0, 0, 0, 1);
  assert.ok(Math.abs(rotationErrors(baseline.rotations24.data, small.rotations24.data).normalizedQuaternionAngleDeg.max - theta * 180 / Math.PI) < 1e-10);
});

test('实际 native 库仅建立 CPU 小 Add toy session 并运行；不创建 GPU session', async () => {
  const modelBytes = toyOnnx();
  let session;
  try {
    session = await ort.InferenceSession.create(new Uint8Array(modelBytes), { executionProviders: ['cpu'] });
    assert.deepEqual(session.inputNames, ['a', 'b']);
    assert.deepEqual(session.outputNames, ['sum']);
    assert.deepEqual(session.inputMetadata.map((item) => item.shape), [[1, 2], [1, 2]]);
    const result = await session.run({ a: new ort.Tensor('float32', Float32Array.from([1, 2]), [1, 2]),
      b: new ort.Tensor('float32', Float32Array.from([2, -3]), [1, 2]) });
    assert.deepEqual(result.sum.dims, [1, 2]);
    assert.deepEqual([...result.sum.data], [3, -1]);
  } finally {
    if (session) await session.release();
  }
});
