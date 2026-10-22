import { performance } from 'node:perf_hooks';
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_MODEL_DIR, DEFAULT_FIXTURES, DEFAULT_RESULTS_DIR } from '../core/paths.mjs';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import {
  ContractError, INPUT_SHAPES, OUTPUT_SHAPES, ensure, exactKeys, fixtureFile,
  loadInputs, loadManifest, loadReference, safeError, sameShape, sha256,
  stats, validateOutputSet,
} from '../core/benchmark-common.mjs';

// 本 CLI 只处理四个已冻结 FP32 Tensor：不解图片、不调用 Python、不操作外部进程。
export function parseArgs(args) {
  const defaults = { model: process.env.HMR2_MODEL_PATH || path.join(DEFAULT_MODEL_DIR, 'model.onnx'), fixtures: process.env.HMR2_FIXTURES || DEFAULT_FIXTURES, provider: process.platform === 'win32' ? 'dml' : 'cpu', optimization: 'all', warmup: 10, repeats: 50, profile: false };
  const values = { ...defaults };
  const allowed = new Set(['model', 'fixtures', 'provider', 'optimization', 'warmup', 'repeats', 'out']);
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    ensure(flag.startsWith('--'), `未知位置参数：${flag.slice(0, 30)}`);
    const name = flag.slice(2);
    if (name === 'profile') {
      ensure(!values.profile, '--profile 重复');
      values.profile = true;
      continue;
    }
    ensure(allowed.has(name), `未知选项：--${name.slice(0, 30)}`);
    ensure(i + 1 < args.length && !args[i + 1].startsWith('--'), `--${name}: 缺少参数`);
    values[name] = args[++i];
  }
  ensure(['all', 'disabled'].includes(values.optimization), '--optimization 只能为 all 或 disabled');
  ensure(['dml', 'cpu'].includes(values.provider), '--provider 只能为 dml 或 cpu');
  for (const key of ['warmup', 'repeats']) {
    const number = Number(values[key]);
    ensure(Number.isSafeInteger(number) && number >= 0 && number <= (key === 'repeats' ? 10_000 : 1_000), `--${key}: 超出范围`);
    values[key] = number;
  }
  ensure(values.repeats > 0, '--repeats: 必须大于 0');
  values.model = path.resolve(process.cwd(), values.model);
  values.fixtures = path.resolve(process.cwd(), values.fixtures);
  values.out = path.resolve(process.cwd(), values.out ?? path.join(DEFAULT_RESULTS_DIR, `node-${values.provider}-${Date.now()}${values.profile ? '-profile' : ''}.json`));
  ensure(new Set([values.model, values.fixtures]).size === 2 &&
    values.out !== values.model && values.out !== values.fixtures, '--out 不能覆盖模型/manifest');
  return values;
}

// Node API 的元数据公开输入/输出名字、形状和 dtype；动态或不明 shape 不可冒充固定 batch1。
export function inspectSession(session) {
  const inspect = (names, metadata, expected, label) => {
    ensure(Array.isArray(names) && Array.isArray(metadata), `${label}: Node 未提供图元数据`);
    exactKeys(Object.fromEntries(names.map((name) => [name, true])), expected, `${label}.names`);
    exactKeys(Object.fromEntries(metadata.map((m) => [m.name, m])), expected, `${label}.metadata`);
    ensure(new Set(names).size === names.length && new Set(metadata.map((m) => m.name)).size === metadata.length, `${label}: 名称重复`);
    for (const entry of metadata) {
      ensure(entry.isTensor === true && entry.type === 'float32', `${label}.${entry.name}: dtype 必须为 float32 tensor`);
      sameShape(entry.shape, expected[entry.name], `${label}.${entry.name}`);
    }
    return metadata.map(({ name, type, shape }) => ({ name, type, shape }));
  };
  return {
    inputs: inspect(session.inputNames, session.inputMetadata, INPUT_SHAPES, 'model.input'),
    outputs: inspect(session.outputNames, session.outputMetadata, OUTPUT_SHAPES, 'model.output'),
  };
}

export function captureOutputs(raw) {
  exactKeys(raw, OUTPUT_SHAPES, 'run.outputs');
  const outputs = {};
  for (const [name, shape] of Object.entries(OUTPUT_SHAPES)) {
    const tensor = raw[name];
    ensure(tensor?.type === 'float32' && tensor?.data instanceof Float32Array, `run.${name}: 必须是 CPU float32 输出`);
    sameShape(tensor.dims, shape, `run.${name}`);
    outputs[name] = { dims: [...tensor.dims], data: Array.from(tensor.data) };
  }
  return validateOutputSet(outputs);
}

export function nativeCapabilities(runtime = ort) {
  const list = typeof runtime.listSupportedBackends === 'function'
    ? runtime.listSupportedBackends()
    : typeof runtime.getAvailableProviders === 'function' ? runtime.getAvailableProviders() : null;
  const backends = Array.isArray(list) ? list.map((entry) => typeof entry === 'string'
    ? { name: entry, bundled: null } : { name: entry.name, bundled: entry.bundled ?? null }) : null;
  return { api: typeof runtime.listSupportedBackends === 'function' ? 'listSupportedBackends'
    : typeof runtime.getAvailableProviders === 'function' ? 'getAvailableProviders' : 'unknown', backends,
  note: 'native 静态能力列表不证明本模型节点已分配到该 EP' };
}

function sessionOptions(provider, profileFilePrefix, optimization = 'all') {
  return {
    graphOptimizationLevel: optimization,
    executionProviders: provider === 'dml' ? [{ name: 'dml', deviceId: 0 }] : ['cpu'],
    executionMode: 'sequential', enableMemPattern: false, intraOpNumThreads: 4, interOpNumThreads: 1,
    ...(profileFilePrefix ? { enableProfiling: true, profileFilePrefix, logSeverityLevel: 2 } : {}),
  };
}

function recordStability(reference, output, accumulators) {
  for (const key of Object.keys(OUTPUT_SHAPES)) {
    const a = reference[key].data;
    const b = output[key].data;
    for (let i = 0; i < a.length; i += 1) {
      const delta = Math.abs(a[i] - b[i]);
      const entry = accumulators[key];
      entry.count += 1;
      entry.maxAbs = Math.max(entry.maxAbs, delta);
      entry.sumSquares += delta * delta;
    }
  }
}

export function finalStability(accumulators) {
  return Object.fromEntries(Object.entries(accumulators).map(([name, { maxAbs, sumSquares, count }]) =>
    [name, { maxAbs, rms: Math.sqrt(sumSquares / count), comparedScalars: count }]));
}

// 起止时钟覆盖 await run、全部返回 CPU Tensor 的访问/拷贝/校验；JSON 写盘与 session.load 不计入热时间。
export async function timedRun(session, feeds) {
  const start = performance.now();
  const outputs = captureOutputs(await session.run(feeds));
  return { elapsedMs: performance.now() - start, outputs, completedEpochMs: Date.now() };
}

function buildFeeds(inputs) {
  return Object.fromEntries(Object.entries(INPUT_SHAPES).map(([name, shape]) =>
    [name, new ort.Tensor('float32', inputs[name], shape)]));
}

function assertFeedsUntouched(sample, inputs) {
  for (const [name, bytes] of Object.entries(inputs)) {
    const actual = sha256(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    ensure(actual.toLowerCase() === sample.inputs[name].sha256.toLowerCase(), `${sample.name}.${name}: 反复运行修改了 baseData`);
  }
}

async function benchmarkSample(session, sample, manifestPath, warmup, repeats) {
  const inputs = await loadInputs(sample, manifestPath);
  const feeds = buildFeeds(inputs);
  const rss = { beforeRunBytes: process.memoryUsage().rss, maxSampledBytes: process.memoryUsage().rss };
  const first = await timedRun(session, feeds);
  rss.maxSampledBytes = Math.max(rss.maxSampledBytes, process.memoryUsage().rss);
  for (let run = 0; run < warmup; run += 1) {
    await timedRun(session, feeds);
    rss.maxSampledBytes = Math.max(rss.maxSampledBytes, process.memoryUsage().rss);
  }
  const elapsed = [];
  let last = null;
  const diff = Object.fromEntries(Object.keys(OUTPUT_SHAPES).map((key) => [key, { maxAbs: 0, sumSquares: 0, count: 0 }]));
  for (let run = 0; run < repeats; run += 1) {
    last = await timedRun(session, feeds);
    elapsed.push(last.elapsedMs);
    recordStability(first.outputs, last.outputs, diff);
    rss.maxSampledBytes = Math.max(rss.maxSampledBytes, process.memoryUsage().rss);
  }
  rss.afterRunBytes = process.memoryUsage().rss;
  assertFeedsUntouched(sample, inputs);
  return {
    name: sample.name, label: sample.label, imageSize: sample.imageSize,
    boxXYXY: sample.boxXYXY, imageSha256: sample.imageSha256,
    inputSha256: Object.fromEntries(Object.entries(sample.inputs).map(([key, value]) => [key, value.sha256])),
    timings: { firstRunMs: first.elapsedMs, firstRunCompletedEpochMs: first.completedEpochMs, warmupRuns: warmup, hotRunsMs: elapsed,
      hot: { p50Ms: stats(elapsed).p50, p95Ms: stats(elapsed).p95, minMs: Math.min(...elapsed), maxMs: Math.max(...elapsed) } },
    outputs: { firstRun: first.outputs, hotLast: last.outputs },
    numericStability: { baseline: 'firstRun', hotRunsCompared: repeats, byOutput: finalStability(diff) },
    memory: { hostRss: rss, gpuProcessBytes: null, gpuMeasurement: 'unavailable' },
  };
}

async function profileEvidence(prefix, beforeNames) {
  const dir = path.dirname(prefix);
  const filename = path.basename(prefix);
  const found = (await readdir(dir)).filter((name) => name.startsWith(filename) && !beforeNames.has(name));
  const profiles = [];
  const counts = {};
  for (const name of found) {
    const file = path.join(dir, name);
    const detail = await stat(file);
    if (!detail.isFile() || detail.size > 30_000_000) continue;
    try {
      const events = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(events)) continue;
      for (const event of events) {
        if (event.cat === 'Node' && typeof event.args?.provider === 'string') {
          const provider = event.args.provider;
          counts[provider] = (counts[provider] ?? 0) + 1;
        }
      }
      profiles.push({ file: name, eventCount: events.length });
    } catch {
      // 原生版本写出的非 JSON 数据不可据此推断 EP，留 unknown 以供人工检查。
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { status: total ? 'confirmed_from_ort_profile' : 'unknown', nodeExecutionCounts: counts,
    profileFiles: profiles, note: '节点计数包括三个单独样本运行；CPU 形状/数据搬运算子可以属于正常分区' };
}

async function diagnoseProfile(session, samples, manifestPath, prefix, beforeNames, provider) {
  for (const sample of samples) {
    const inputs = await loadInputs(sample, manifestPath);
    await timedRun(session, buildFeeds(inputs));
    assertFeedsUntouched(sample, inputs);
  }
  if (typeof session.endProfiling !== 'function') {
    return { status: 'unknown', nodeExecutionCounts: {}, profileFiles: [],
      note: 'Node API 不提供 endProfiling；不能确认实际 EP 节点分配' };
  }
  try {
    session.endProfiling();
  } catch {
    return { status: 'unknown', nodeExecutionCounts: {}, profileFiles: [],
      note: 'native endProfiling 未能产出可确认的 profile；隐藏底层可能含宿主路径的错误信息' };
  }
  const evidence = await profileEvidence(prefix, beforeNames);
  if (provider === 'dml' && evidence.status === 'confirmed_from_ort_profile') {
    const dmlCount = Object.entries(evidence.nodeExecutionCounts).filter(([name]) => /dml/i.test(name))
      .reduce((total, [, count]) => total + count, 0);
    if (dmlCount === 0) return { ...evidence, status: 'rejected_no_requested_ep',
      note: 'profile 只发现非 DML 节点；拒绝将此结果称作 DML 运行' };
  }
  return evidence;
}

export async function runBenchmark(options) {
  try {
    await access(options.out);
    throw new ContractError('--out 已存在；为防覆盖和重复 GPU 加载，请选用新文件名');
  } catch (error) {
    if (error instanceof ContractError || error?.code !== 'ENOENT') throw error;
  }
  const { manifest, sha256: fixtureSha256 } = await loadManifest(options.fixtures);
  // 参考数值读取在创建 session 及热循环前，保证冻结数据和形状有效，不进入计时。
  for (const sample of manifest.samples) {
    await loadReference(sample, options.fixtures);
    for (const key of Object.keys(INPUT_SHAPES)) await fixtureFile(options.fixtures, sample.inputs[key].path, `${sample.name}.${key}`);
  }
  const modelInfo = await stat(options.model);
  ensure(modelInfo.isFile() && modelInfo.size > 0 && modelInfo.size <= 32 * 1024 * 1024, 'model: 必须是至多32MiB的external-data小图');
  const modelSha256 = sha256(await readFile(options.model));
  const capability = nativeCapabilities();
  if (capability.backends) {
    ensure(capability.backends.some((entry) => entry.name === options.provider), `native 未列出请求的 ${options.provider} EP；禁止自动切 CPU`);
  }
  const ortVersion = ort.env?.versions?.node ?? 'unknown';
  const report = {
    schemaVersion: 1, kind: options.profile ? 'node-onnx-diagnostic' : 'node-onnx-benchmark',
    createdAt: new Date().toISOString(),
    model: { path: path.relative(process.cwd(), options.model), onnxBytes: modelInfo.size, sha256: modelSha256,
      loading: 'native InferenceSession.create(模型路径)；不将 external-data 大权重读入 JS' },
    fixtures: { path: path.relative(process.cwd(), options.fixtures), manifestSha256: fixtureSha256,
      sampleCount: manifest.samples.length, independentAccuracySamples: manifest.samples.length },
    runtime: { node: process.version, platform: process.platform, arch: process.arch,
      package: 'onnxruntime-node', packageVersion: ortVersion,
      precision: { inputTensor: 'float32', outputTensor: 'float32', modelWeights: 'not independently inspected here',
        dmlInternal: 'unknown', tf32: 'unknown' },
      requestedEp: options.provider, nativeCapability: capability,
      actualAssignment: { status: 'unknown', reason: 'API 的 native 后端列表/成功创建 session 不能证明每个节点分配；用 --profile 单独诊断' },
      sessionOptions: sessionOptions(options.provider, undefined, options.optimization),
      executionBoundary: 'performance.now: before session.run -> all validated CPU float32 outputs copied',
      firstRunNote: '仅第一张图的 firstRun 为本 session 首推；其余图在同一已预热 session 上第一次使用该图输入，不能称独立冷启动',
      processColdStartMs: null, processColdStartNote: '进程到ready与首输出可由外层监督器结合epoch时点计算；OS cache未清', preSessionUptimeMs: process.uptime() * 1000,
      gpuMemoryBytes: null, gpuMemoryNote: '未提供按本进程计的 GPU allocator/VRAM 口径' },
    timings: { sessionLoadMs: null, rssBeforeSessionBytes: process.memoryUsage().rss, rssAfterSessionBytes: null },
    samples: [],
  };
  let session;
  let profilePrefix;
  let previousFiles;
  if (options.profile) {
    // 唯一前缀防止覆盖其他 ORT 日志；此诊断不会运行预热/热测，故不能混入 p50/p95。
    profilePrefix = path.join(path.dirname(options.out), `ort-profile-${Date.now()}-${process.pid}-`);
    await mkdir(path.dirname(profilePrefix), { recursive: true });
    previousFiles = new Set(await readdir(path.dirname(profilePrefix)));
  }
  try {
    const start = performance.now();
    session = await ort.InferenceSession.create(options.model, sessionOptions(options.provider, profilePrefix, options.optimization));
    report.timings.sessionLoadMs = performance.now() - start;
    report.timings.sessionReadyEpochMs = Date.now();
    report.timings.rssAfterSessionBytes = process.memoryUsage().rss;
    report.graph = inspectSession(session);
    if (options.profile) {
      report.runtime.actualAssignment = await diagnoseProfile(session, manifest.samples, options.fixtures, profilePrefix, previousFiles, options.provider);
      report.diagnostic = { runCount: manifest.samples.length, timedHotRuns: 0,
        profilingNote: '启用 native ORT enableProfiling；仅含诊断 run，与正式基准时间分离' };
    } else {
      for (const sample of manifest.samples) {
        report.samples.push(await benchmarkSample(session, sample, options.fixtures, options.warmup, options.repeats));
      }
    }
  } finally {
    if (session) await session.release();
  }
  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  ensure(report.runtime.actualAssignment.status !== 'rejected_no_requested_ep',
    'DML profile 无任何 DML 节点：已写入诊断证据但拒绝将回退视为 GPU 成功');
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await runBenchmark(options);
    console.log(JSON.stringify({ report: path.relative(process.cwd(), options.out), kind: report.kind,
      requestedEp: report.runtime.requestedEp, actualStatus: report.runtime.actualAssignment.status,
      sampleCount: report.fixtures.sampleCount, nativeCapability: report.runtime.nativeCapability.backends }));
  } catch (error) {
    console.error(`阶段A基准失败：${safeError(error)}`);
    process.exitCode = 1;
  }
}
