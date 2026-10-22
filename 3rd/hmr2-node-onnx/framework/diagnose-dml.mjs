import * as ort from 'onnxruntime-node';
import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_RESULTS_DIR } from '../core/paths.mjs';
const assetRoot = process.env.HMR2_BENCH_ASSETS_DIR || 'E:/ai/ai-depthmap/hmr2_node_onnx';

// 诊断只运行批准的自有小算子/full图初始化；错误原文仅保存本机日志，不改任何设备或驱动。
const reports = [];
const stage = process.argv.includes('--rot6d');
const gatherStage = process.argv.includes('--scalar-gather');
const chainStage = process.argv.includes('--gather-chain');
const zeroStage = process.argv.includes('--allowzero');
const output = path.join(DEFAULT_RESULTS_DIR, `diagnostic-${Date.now()}-${process.pid}-`, path.basename(zeroStage ? 'results/dml-allowzero.json' : chainStage ? 'results/dml-gather-chain.json' : gatherStage ? 'results/dml-scalar-gather.json' : stage ? 'results/dml-rot6d-diagnostics.json' : 'results/dml-diagnostics.json'));
const options = { executionProviders: [{ name: 'dml', deviceId: 0 }], executionMode: 'sequential', enableMemPattern: false,
  intraOpNumThreads: 4, interOpNumThreads: 1, logSeverityLevel: 0, logVerbosityLevel: 1 };
for (const name of zeroStage ? ['allowzero_negative', 'allowzero_fixed'] : chainStage ? ['rotgatherchain'] : gatherStage ? ['gatherscalar', 'gathersqueeze'] : stage ? ['einsumdot', 'reducel2', 'split3'] : ['add', 'layernorm', 'layernorm3out', 'gather', 'gathernd', 'einsum', 'full-init']) {
  let session;
  const start = performance.now();
  try {
    session = await ort.InferenceSession.create(path.resolve(assetRoot, name === 'full-init' ? 'models/fp32-op18/model.onnx' : `models/diagnostics/${name}.onnx`), options);
    const loadMs = performance.now() - start;
    if (name !== 'full-init') {
      const feeds = Object.fromEntries(session.inputMetadata.map((m) => [m.name,
        new ort.Tensor('float32', Float32Array.from({ length: m.shape.reduce((a, b) => a * b, 1) }, (_, i) => (i % 17) * 0.01), m.shape)]));
      const got = await session.run(feeds);
      if (!Object.values(got).every((x) => x.data.every(Number.isFinite))) throw new Error('toy non-finite');
    }
    reports.push({ name, passed: true, loadMs, actualEp: 'not profiled; requested DML' });
  } catch (error) {
    reports.push({ name, passed: false, elapsedMs: performance.now() - start, error: String(error?.message ?? error) });
  } finally {
    if (session) await session.release();
  }
  console.log(JSON.stringify(reports.at(-1)));
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ runtime: process.version, packageVersion: ort.env.versions.node, options, cases: reports }, null, 2), { flag: 'wx' });
// 完整图失败仍用非零exit，不能把toy成功当HMR GPU成功。
if (reports.some((entry) => !entry.passed)) process.exitCode = 1;
