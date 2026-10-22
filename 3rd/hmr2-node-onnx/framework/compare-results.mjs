import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_FIXTURES, DEFAULT_RESULTS_DIR } from '../core/paths.mjs';
import { fileURLToPath } from 'node:url';
import {
  INPUT_SHAPES, OUTPUT_SHAPES, ensure, exactKeys, loadManifest, loadReference,
  readJsonLimited, safeError, stats, validateOutputSet,
} from '../core/benchmark-common.mjs';

// 原始分量、det、正交度与 trace 全部基于原预测；稳定角单独使用 metric-only 四元数投影。
export function absoluteErrors(reference, candidate) {
  ensure(reference.length === candidate.length && reference.length > 0, '比较数值数组长度不一致');
  return reference.map((value, index) => Math.abs(value - candidate[index]));
}

export function matrixQuality(values, offset) {
  const [a, b, c, d, e, f, g, h, i] = values.slice(offset, offset + 9);
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  let sum = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      let dot = 0;
      for (let inner = 0; inner < 3; inner += 1) {
        dot += values[offset + inner * 3 + row] * values[offset + inner * 3 + col];
      }
      const error = dot - (row === col ? 1 : 0);
      sum += error * error;
    }
  }
  return { determinant, determinantDeviation: Math.abs(determinant - 1), orthogonalityFrobenius: Math.sqrt(sum) };
}

// 伪代码：.src/framework/hmr2-node-onnx-benchmark.md；仅在度量中取归一化四元数，不修复或覆盖原始矩阵。
function matrixToUnitQuaternion(values, offset) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = values.slice(offset, offset + 9);
  const trace = m00 + m11 + m22;
  let w;
  let x;
  let y;
  let z;
  let scale;
  if (trace > 0) {
    scale = 2 * Math.sqrt(1 + trace);
    w = scale / 4;
    x = (m21 - m12) / scale;
    y = (m02 - m20) / scale;
    z = (m10 - m01) / scale;
  } else if (m00 > m11 && m00 > m22) {
    scale = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / scale;
    x = scale / 4;
    y = (m01 + m10) / scale;
    z = (m02 + m20) / scale;
  } else if (m11 > m22) {
    scale = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / scale;
    x = (m01 + m10) / scale;
    y = scale / 4;
    z = (m12 + m21) / scale;
  } else {
    scale = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / scale;
    x = (m02 + m20) / scale;
    y = (m12 + m21) / scale;
    z = scale / 4;
  }
  const norm = Math.hypot(w, x, y, z);
  ensure(Number.isFinite(norm) && norm > 0, '旋转矩阵无法转换为有效度量四元数');
  return [w / norm, x / norm, y / norm, z / norm];
}

// abs(w) 消去 q 与 -q 的双覆盖；atan2 对微小角稳定，严格相同矩阵的相对向量为零。
export function normalizedQuaternionAngleDeg(reference, candidate, offset = 0) {
  const [aw, ax, ay, az] = matrixToUnitQuaternion(reference, offset);
  const [bw, bx, by, bz] = matrixToUnitQuaternion(candidate, offset);
  const w = aw * bw + ax * bx + ay * by + az * bz;
  const x = aw * bx - ax * bw - ay * bz + az * by;
  const y = aw * by + ax * bz - ay * bw - az * bx;
  const z = aw * bz - ax * by + ay * bx - az * bw;
  return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w)) * (180 / Math.PI);
}

export function rotationErrors(reference, candidate) {
  ensure(reference.length === 216 && candidate.length === 216, '旋转必须为 24 个 3x3 矩阵');
  const angles = [];
  const quaternionAngles = [];
  const referenceDet = [];
  const candidateDet = [];
  const referenceOrth = [];
  const candidateOrth = [];
  for (let joint = 0; joint < 24; joint += 1) {
    const offset = joint * 9;
    // tr(Ra^T Rb) 是对应矩阵分量内积；clamp 仅避免浮点 acos 越界，不修改预测。
    let trace = 0;
    for (let i = 0; i < 9; i += 1) trace += reference[offset + i] * candidate[offset + i];
    const cosine = Math.max(-1, Math.min(1, (trace - 1) / 2));
    angles.push(Math.acos(cosine) * (180 / Math.PI));
    quaternionAngles.push(normalizedQuaternionAngleDeg(reference, candidate, offset));
    const ref = matrixQuality(reference, offset);
    const got = matrixQuality(candidate, offset);
    referenceDet.push(ref.determinantDeviation);
    candidateDet.push(got.determinantDeviation);
    referenceOrth.push(ref.orthogonalityFrobenius);
    candidateOrth.push(got.orthogonalityFrobenius);
  }
  return {
    angleDeg: stats(angles),
    normalizedQuaternionAngleDeg: stats(quaternionAngles),
    determinantAbsDeviationFromOne: { reference: stats(referenceDet), candidate: stats(candidateDet) },
    orthogonalityFrobenius: { reference: stats(referenceOrth), candidate: stats(candidateOrth) },
    caveat: '原 trace angleDeg 会混入 FP32 非严格正交底噪；normalizedQuaternionAngleDeg 为仅用于度量的标准归一化四元数投影与相对 atan2，原始矩阵输出/分量/det/正交度均未修改',
  };
}

function pointErrors(reference, candidate, pointWidth, factor) {
  const distances = [];
  for (let index = 0; index < reference.length; index += pointWidth) {
    let sum = 0;
    for (let component = 0; component < pointWidth; component += 1) {
      const delta = reference[index + component] - candidate[index + component];
      sum += delta * delta;
    }
    distances.push(Math.sqrt(sum) * factor);
  }
  return stats(distances);
}

export function compareOutputs(reference, candidate) {
  validateOutputSet(reference, OUTPUT_SHAPES, 'reference');
  validateOutputSet(candidate, OUTPUT_SHAPES, 'candidate');
  const measurements = {};
  for (const key of Object.keys(OUTPUT_SHAPES)) {
    const a = reference[key].data;
    const b = candidate[key].data;
    measurements[key] = { flatAbsolute: stats(absoluteErrors(a, b)) };
  }
  measurements.xyz.pointEuclideanMm = pointErrors(reference.xyz.data, candidate.xyz.data, 3, 1_000);
  measurements.xy.pointEuclideanPx = pointErrors(reference.xy.data, candidate.xy.data, 2, 1);
  measurements.rotations24 = { ...measurements.rotations24,
    ...rotationErrors(reference.rotations24.data, candidate.rotations24.data) };
  return measurements;
}

// 原始维度必须逐项相同，样本哈希不能被另一次不同预处理的缓存冒名替代。
export function verifyResult(result, manifest, label) {
  ensure(result?.schemaVersion === 1 && result.kind !== 'node-onnx-diagnostic', `${label}: 不是可比对的基准结果`);
  ensure(Array.isArray(result.samples) && result.samples.length === manifest.samples.length, `${label}: 样本数不匹配`);
  const names = new Set();
  for (const sample of result.samples) {
    ensure(typeof sample?.name === 'string' && !names.has(sample.name), `${label}: 样本名缺失或重复`);
    names.add(sample.name);
    const frozen = manifest.samples.find((entry) => entry.name === sample.name);
    ensure(frozen, `${label}: 未知样本`);
    ensure(sample.imageSha256 === frozen.imageSha256, `${label}.${sample.name}: 原图 SHA 不匹配`);
    exactKeys(sample.inputSha256, INPUT_SHAPES, `${label}.${sample.name}.inputSha256`);
    for (const [name, record] of Object.entries(frozen.inputs)) {
      ensure(sample.inputSha256[name].toLowerCase() === record.sha256.toLowerCase(), `${label}.${sample.name}.${name}: 冻结 Tensor SHA 不匹配`);
    }
    ensure(sample.outputs && typeof sample.outputs === 'object', `${label}.${sample.name}: 缺少原始输出`);
    validateOutputSet(sample.outputs.firstRun, OUTPUT_SHAPES, `${label}.${sample.name}.firstRun`);
    validateOutputSet(sample.outputs.hotLast, OUTPUT_SHAPES, `${label}.${sample.name}.hotLast`);
    const timing = sample.timings;
    if (timing) {
      ensure(Number.isFinite(timing.firstRunMs) && timing.firstRunMs >= 0, `${label}.${sample.name}: 首推时间无效`);
      if (timing.hotRunsMs) {
        ensure(Array.isArray(timing.hotRunsMs) && timing.hotRunsMs.length > 0 &&
          timing.hotRunsMs.every((n) => Number.isFinite(n) && n >= 0), `${label}.${sample.name}: 热测时间无效`);
      }
    }
  }
  return new Map(result.samples.map((sample) => [sample.name, sample]));
}

export async function generateComparison(manifestPath, nodeResult, torchResult = null) {
  const { manifest, sha256: manifestSha256 } = await loadManifest(manifestPath);
  const node = verifyResult(nodeResult, manifest, 'node');
  const torch = torchResult ? verifyResult(torchResult, manifest, 'torch') : null;
  const rows = [];
  for (const frozen of manifest.samples) {
    const reference = await loadReference(frozen, manifestPath);
    const nodeSample = node.get(frozen.name);
    const torchSample = torch?.get(frozen.name);
    const comparisons = { nodeVsReference: compareOutputs(reference, nodeSample.outputs.hotLast) };
    if (torchSample) {
      comparisons.torchVsReference = compareOutputs(reference, torchSample.outputs.hotLast);
      comparisons.nodeVsTorch = compareOutputs(torchSample.outputs.hotLast, nodeSample.outputs.hotLast);
    }
    const stability = (sample) => ({ firstVsHotLast: compareOutputs(sample.outputs.firstRun, sample.outputs.hotLast),
      hotRunsCompared: sample.numericStability?.hotRunsCompared ?? null,
      reportedHotVsFirst: sample.numericStability?.byOutput ?? null });
    rows.push({ name: frozen.name, label: frozen.label, imageSha256: frozen.imageSha256,
      comparisons, repeatNumericStability: { node: stability(nodeSample),
        ...(torchSample ? { torch: stability(torchSample) } : {}) },
      timing: {
        node: nodeSample.timings ? { firstRunMs: nodeSample.timings.firstRunMs,
          hotP50Ms: nodeSample.timings.hot?.p50Ms ?? null, hotP95Ms: nodeSample.timings.hot?.p95Ms ?? null,
          warmupRuns: nodeSample.timings.warmupRuns ?? null,
          hotRepeats: nodeSample.timings.hotRunsMs?.length ?? null } : null,
        ...(torchSample ? { torch: torchSample.timings ? { firstRunMs: torchSample.timings.firstRunMs,
          hotP50Ms: torchSample.timings.hot?.p50Ms ?? null, hotP95Ms: torchSample.timings.hot?.p95Ms ?? null,
          warmupRuns: torchSample.timings.warmupRuns ?? null,
          hotRepeats: torchSample.timings.hotRunsMs?.length ?? null } : null } : {}),
      },
    });
  }
  return {
    schemaVersion: 1, kind: 'hmr2-frozen-tensor-comparison', createdAt: new Date().toISOString(),
    fixtureManifestSha256: manifestSha256,
    scope: { independentImageSamples: manifest.samples.length, jointsPerSample: 25,
      interpretation: '重复运行数及 25×图像数的关节均不等于独立识别准确率样本；没有真值 3D 标注' },
    environment: { node: nodeResult.runtime ?? null, torch: torchResult?.runtime ?? null,
      caveat: '不同 EP、CUDA/DML、操作/机器/时间窗口组合不能被归因为 Node vs Python 语言速度差；先核验实际 EP/profile/负载和边界' },
    comparisons: rows,
    assessment: { numericThresholds: 'not supplied; no invented FP32 pass criterion',
      groundTruthAccuracy: 'not measured; these are predictions vs reference and repeats',
      fullImagePipeline: 'not tested (frozen Tensor only)',
      assignedEp: nodeResult.runtime?.actualAssignment?.status ?? 'unknown' },
  };
}

function markdownEscape(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('\r', ' ');
}

function fmt(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toPrecision(6) : 'unknown';
}

export function comparisonMarkdown(report) {
  const lines = [
    '# HMR2 同冻结 Tensor 后端数值与耗时对照', '',
    `- 图像独立样本：${report.scope.independentImageSamples}（每图 25 点；热重复运行不增加准度样本数）。`,
    '- 仅对比模型预测输出与冻结参考，无真值识别准确率、MPJPE/PA-MPJPE/PCK；不测试原图 API。',
    '- XYZ 数值按米→毫米换算；XY按像素。主角度仅度量中取归一化四元数再计算相对atan2，原trace角另列以显示FP32非正交底噪；不修改任何预测矩阵。',
    '- 原生能力列表不是实际 EP 节点分配；CUDA/DML 与 PyTorch/ORT 的部署组合差异不可归因为语言差异。',
    '- 数值阈值：未提供；这里只报告原始误差，不擅自宣称达到 FP32 等价。', '',
    '| 样本 | 对照 | XYZ点max/RMS mm | XY点max/RMS px | 稳定旋转角max/RMS ° | trace角max/RMS ° | betas max/RMS | fullcam max/RMS | depth max/RMS |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  const metric = (pair) => `${fmt(pair.max)} / ${fmt(pair.rms)}`;
  for (const row of report.comparisons) {
    for (const [name, result] of Object.entries(row.comparisons)) {
      lines.push(`| ${markdownEscape(row.name)} | ${markdownEscape(name)} | ${metric(result.xyz.pointEuclideanMm)} | ${metric(result.xy.pointEuclideanPx)} | ${metric(result.rotations24.normalizedQuaternionAngleDeg)} | ${metric(result.rotations24.angleDeg)} | ${metric(result.betas10.flatAbsolute)} | ${metric(result.cameraTranslation.flatAbsolute)} | ${metric(result.cameraDepth.flatAbsolute)} |`);
    }
  }
  lines.push('', '## 全九输出分量绝对误差', '',
    '| 样本 | 对照 | 输出字段 | flat maxAbs | flat RMS |',
    '|---|---|---|---:|---:|');
  for (const row of report.comparisons) {
    for (const [name, result] of Object.entries(row.comparisons)) {
      for (const [key, shape] of Object.entries(OUTPUT_SHAPES)) {
        lines.push(`| ${markdownEscape(row.name)} | ${markdownEscape(name)} | ${key} ${shape.join('×')} | ${fmt(result[key].flatAbsolute.max)} | ${fmt(result[key].flatAbsolute.rms)} |`);
      }
    }
  }
  lines.push('', '## 旋转合法性与重复数值稳定性', '',
    '| 样本 | 对照 | det离1最大值 参考/候选 | 正交F最大值 参考/候选 |',
    '|---|---|---:|---:|');
  for (const row of report.comparisons) {
    for (const [name, result] of Object.entries(row.comparisons)) {
      const rot = result.rotations24;
      lines.push(`| ${markdownEscape(row.name)} | ${markdownEscape(name)} | ${fmt(rot.determinantAbsDeviationFromOne.reference.max)} / ${fmt(rot.determinantAbsDeviationFromOne.candidate.max)} | ${fmt(rot.orthogonalityFrobenius.reference.max)} / ${fmt(rot.orthogonalityFrobenius.candidate.max)} |`);
    }
  }
  lines.push('', '| 样本 | 执行组 | 首run与热尾帧XYZ点max mm | 热重复次数 | 各字段重复稳定性 |',
    '|---|---|---:|---:|---|');
  for (const row of report.comparisons) {
    for (const [name, stability] of Object.entries(row.repeatNumericStability)) {
      const fieldMaxima = stability.reportedHotVsFirst
        ? Object.entries(stability.reportedHotVsFirst).map(([key, value]) => `${key}: ${fmt(value.maxAbs)}`).join('; ')
        : 'unknown';
      lines.push(`| ${markdownEscape(row.name)} | ${name} | ${fmt(stability.firstVsHotLast.xyz.pointEuclideanMm.max)} | ${stability.hotRunsCompared ?? '?'} | ${fieldMaxima} |`);
    }
  }
  lines.push('', '## 每图时间（ms）', '',
    '| 样本 | 执行组 | 首推 | 热p50 | 热p95 | 预热/热重复 |',
    '|---|---|---:|---:|---:|---:|');
  for (const row of report.comparisons) {
    for (const [name, timing] of Object.entries(row.timing)) {
      lines.push(`| ${markdownEscape(row.name)} | ${name} | ${fmt(timing?.firstRunMs)} | ${fmt(timing?.hotP50Ms)} | ${fmt(timing?.hotP95Ms)} | ${timing?.warmupRuns ?? '?'} / ${timing?.hotRepeats ?? '?'} |`);
    }
  }
  lines.push('', '## 附加原始统计', '',
    '- JSON 包含各图 XYZ/XY flat maxAbs/RMS、24个旋转 determinant/正交度、所有 betas/cam/depth/focal/principalPoint 的绝对 max/RMS，以及首推对热尾帧和报告的热重复稳定性。',
    '- Node 计时边界为 session.run 到完整 CPU 张量返回（含校验拷贝）；模型加载独立计时；Torch 时间须由父侧另述其同步/传输边界；profile 不得混入热测。',
    '');
  return lines.join('\n');
}

export function parseArgs(args) {
  const values = { fixtures: process.env.HMR2_FIXTURES || DEFAULT_FIXTURES, node: process.env.HMR2_NODE_RESULTS || '',
    out: path.join(DEFAULT_RESULTS_DIR, `comparison-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.json`) };
  const allowed = new Set(['fixtures', 'node', 'results', 'torch', 'out']);
  for (let i = 0; i < args.length; i += 1) {
    ensure(args[i].startsWith('--'), 'compare: 不接受位置参数');
    const key = args[i].slice(2);
    ensure(allowed.has(key) && i + 1 < args.length && !args[i + 1].startsWith('--'), `compare: --${key} 参数错误`);
    values[key === 'results' ? 'node' : key] = args[++i];
  }
  ensure(values.node, 'compare: 请显式指定 --node 基准JSON；不猜测旧results目录');
  for (const key of ['fixtures', 'node', 'out']) values[key] = path.resolve(process.cwd(), values[key]);
  if (values.torch) values.torch = path.resolve(process.cwd(), values.torch);
  if (values.out.toLowerCase().endsWith('.md')) values.out = values.out.slice(0, -3) + '.json';
  else if (!values.out.toLowerCase().endsWith('.json')) values.out += '.json';
  const markdown = values.out.slice(0, -5) + '.md';
  ensure(![values.fixtures, values.node, values.torch].includes(values.out) &&
    ![values.fixtures, values.node, values.torch].includes(markdown), 'compare: 输出不可覆盖输入');
  return { ...values, markdown };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { json: node } = await readJsonLimited(options.node, 50_000_000, 'node result');
    const torch = options.torch ? (await readJsonLimited(options.torch, 50_000_000, 'torch result')).json : null;
    const report = await generateComparison(options.fixtures, node, torch);
    await mkdir(path.dirname(options.out), { recursive: true });
    await mkdir(path.dirname(options.markdown), { recursive: true });
    await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await writeFile(options.markdown, comparisonMarkdown(report), { encoding: 'utf8', flag: 'wx' });
    console.log(JSON.stringify({ json: path.relative(process.cwd(), options.out),
      markdown: path.relative(process.cwd(), options.markdown), independentSamples: report.scope.independentImageSamples }));
  } catch (error) {
    console.error(`阶段A对照失败：${safeError(error)}`);
    process.exitCode = 1;
  }
}
