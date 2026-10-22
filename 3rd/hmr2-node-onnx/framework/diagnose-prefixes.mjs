import * as ort from 'onnxruntime-node';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { DEFAULT_RESULTS_DIR } from '../core/paths.mjs';
const assetRoot = process.env.HMR2_BENCH_ASSETS_DIR || 'E:/ai/ai-depthmap/hmr2_node_onnx';

// 只检查抽取的前缀能否初始化；权重共享只读，session顺序释放，不能据此宣称整图GPU成功。
const cases = JSON.parse(await readFile(path.join(assetRoot, 'results/dml-prefixes.json'), 'utf8'));
const results = [];
for (const entry of cases) {
  let session;
  const start = performance.now();
  try {
    session = await ort.InferenceSession.create(path.resolve(assetRoot, entry.path), { executionProviders: [{ name: 'dml', deviceId: 0 }],
      executionMode: 'sequential', enableMemPattern: false, intraOpNumThreads: 4, interOpNumThreads: 1, logSeverityLevel: 3 });
    results.push({ ...entry, passed: true, ms: performance.now() - start });
  } catch (error) {
    results.push({ ...entry, passed: false, ms: performance.now() - start, error: String(error?.message ?? error) });
  } finally {
    if (session) await session.release();
  }
  console.log(JSON.stringify({ index: entry.index, ...results.at(-1) }));
}
await mkdir(DEFAULT_RESULTS_DIR, { recursive: true });
await writeFile(path.join(DEFAULT_RESULTS_DIR, `dml-prefix-init.json-${Date.now()}-${process.pid}.json`), JSON.stringify(results, null, 2), { flag: 'wx' });
