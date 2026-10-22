import * as ort from 'onnxruntime-node';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_RESULTS_DIR } from '../core/paths.mjs';
const assetRoot = process.env.HMR2_BENCH_ASSETS_DIR || 'E:/ai/ai-depthmap/hmr2_node_onnx';

const items = JSON.parse(await readFile(path.join(assetRoot, 'results/dml-rot-prefixes.json'), 'utf8'));
const results = [];
for (const item of items) {
  let session;
  try {
    session = await ort.InferenceSession.create(path.resolve(assetRoot, item.path), { executionProviders: [{ name: 'dml', deviceId: 0 }],
      executionMode: 'sequential', enableMemPattern: false, intraOpNumThreads: 4, interOpNumThreads: 1, logSeverityLevel: 3 });
    const input = Float32Array.from({ length: 144 }, (_, index) => Math.sin(index * 0.31) + Math.cos(index * 0.05));
    const got = await session.run({ add_85: new ort.Tensor('float32', input, [1, 144]) });
    if (!Object.values(got).every((x) => x.data.every(Number.isFinite))) throw new Error('nonfinite');
    results.push({ ...item, passed: true });
  } catch (error) {
    results.push({ ...item, passed: false, error: String(error?.message ?? error) });
  } finally {
    if (session) await session.release();
  }
  console.log(JSON.stringify({ index: item.index, op: item.op, passed: results.at(-1).passed }));
}
await mkdir(DEFAULT_RESULTS_DIR, { recursive: true });
await writeFile(path.join(DEFAULT_RESULTS_DIR, `dml-rot-prefix-init.json-${Date.now()}-${process.pid}.json`), JSON.stringify(results, null, 2), { flag: 'wx' });
// 仅诊断，不把纯6D小图通过等同于HMR完整图成功。
