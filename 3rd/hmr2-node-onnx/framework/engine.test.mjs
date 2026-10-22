import test from 'node:test';
import assert from 'node:assert/strict';
import * as ort from 'onnxruntime-node';
import { Hmr2Engine } from './engine.mjs';
import { INPUT_SHAPES, OUTPUT_SHAPES, sha256 } from '../core/benchmark-common.mjs';
import { NODE_SOURCE } from '../core/body25.mjs';
import { parseServerArgs } from '../app/server.mjs';
import { parseDownloadArgs } from '../app/download-model.mjs';

// 假session只证明引擎单飞、DTO和原样Tensor合同，不当完整HMR/GPU实测。
function prepared() {
  const inputs = Object.fromEntries(Object.entries(INPUT_SHAPES).map(([key, shape]) => [key, new Float32Array(shape.reduce((a, b) => a * b, 1))]));
  inputs.box_center.set([160, 120]); inputs.box_size[0] = 320; inputs.img_size.set([320, 240]);
  return { inputs, metadata: { imageSize: [320, 240], boxXYXY: [0, 0, 320, 240], bboxSource: 'full_image_fallback', inputTensorSha256: sha256(Buffer.from(inputs.img.buffer)) } };
}
function outputs() {
  const values = Object.fromEntries(Object.entries(OUTPUT_SHAPES).map(([key, shape]) => {
    const data = new Float32Array(shape.reduce((a, b) => a * b, 1));
    if (key === 'cameraDepth') data.fill(1);
    if (key === 'focalLengthPx') data[0] = 1000;
    if (key === 'cameraTranslation') data[2] = 1;
    if (key === 'principalPointPx') data.set([160, 120]);
    if (key === 'xy') for (let point = 0; point < 25; point += 1) data.set([160, 120], point * 2);
    return [key, new ort.Tensor('float32', data, shape)];
  }));
  return values;
}

test('CLI根目录默认与独立8769、非loopback token、非法provider/线程/端口拒绝，不启动服务', () => {
  assert.equal(parseServerArgs([], {}).port, 8769);
  assert.ok(parseDownloadArgs([], {}).modelDir.endsWith('fp32-op18-dml-static'));
  assert.throws(() => parseServerArgs(['--provider', 'cuda'], {}), /provider/);
  assert.throws(() => parseServerArgs(['--host', '0.0.0.0'], {}), /token/);
  assert.equal(parseServerArgs(['--host', '0.0.0.0', '--token', 'x'], {}).apiToken, 'x');
  assert.throws(() => parseServerArgs(['--port', '65536'], {}), /端口/);
  assert.throws(() => parseServerArgs(['--threads', '0'], {}), /线程/);
  for (const threads of [0, -1, 1.5, 33, Number.NaN, '4', null]) {
    assert.throws(() => new Hmr2Engine({ provider: 'cpu', intraOpNumThreads: threads }),
      (error) => error.status === 400 && error.code === 'invalid_config');
  }
  for (const threads of [1, 32]) {
    assert.equal(new Hmr2Engine({ provider: 'cpu', intraOpNumThreads: threads }).options.intraOpNumThreads, threads);
  }
  assert.throws(() => parseDownloadArgs(['--url', 'secret'], {}), /参数/);
});

test('新引擎health不load；真实CPU标签与unknown allocator不填假GPU，DTO九输出保持原结构', async () => {
  const engine = new Hmr2Engine({ provider: 'cpu' });
  assert.equal(engine.health().ready, false);
  assert.equal(engine.health().loadCount, 0);
  assert.equal(engine.health().gpu, null);
  assert.equal(engine.health().memory.allocatedMiB, null);
  engine.ready = true; engine.session = { run: async () => outputs(), release: async () => {} };
  const batch = prepared();
  const result = await engine.runPrepared(batch.inputs, batch.metadata);
  assert.equal(result.device, 'cpu'); assert.equal(result.source, NODE_SOURCE);
  assert.equal(result.xyz.length, 25); assert.equal(result.xy.length, 25);
  assert.equal(result.rotations24.length, 24); assert.equal(result.betas10.length, 10);
  assert.equal(result.timingMs.network, null);
  assert.equal(result.runtime.internalPrecision, 'unknown');
  assert.equal(engine.busy, false);
  await engine.close();

  // 延迟假加载故意在closing后设置ready，验证close等加载并最终保持关闭。
  let finishLoad;
  const loadGate = new Promise((resolve) => { finishLoad = resolve; });
  let releases = 0;
  const loading = new Hmr2Engine({ provider: 'cpu' });
  loading.loadOnce = async function () {
    await loadGate;
    this.session = { release: async () => { releases += 1; } };
    this.ready = true;
  };
  const started = loading.load();
  const firstClose = loading.close();
  const secondClose = loading.close();
  assert.strictEqual(firstClose, secondClose);
  assert.equal(loading.ready, false);
  assert.equal(releases, 0);
  finishLoad();
  await started;
  await Promise.all([firstClose, secondClose]);
  assert.equal(loading.ready, false);
  assert.equal(loading.session, null);
  assert.equal(releases, 1);
  await loading.close();
  assert.equal(releases, 1);
  await assert.rejects(loading.load(), (error) => error.status === 503 && error.code === 'model_not_ready');

  // profiling收尾失败也必须在finally释放资源、断开session，不得重复释放。
  const profiled = new Hmr2Engine({ provider: 'cpu', profileFilePrefix: 'unused-fake-profile' });
  let profileReleases = 0;
  profiled.ready = true;
  profiled.session = { endProfiling: () => { throw new Error('fake-profile-failure'); },
    release: async () => { profileReleases += 1; } };
  const profileClose = profiled.close();
  assert.strictEqual(profileClose, profiled.close());
  await assert.rejects(profileClose, /fake-profile-failure/);
  assert.equal(profileReleases, 1);
  assert.equal(profiled.session, null);
  assert.equal(profiled.ready, false);
});

test('假session busy先于输入校验，异常释放且不泄露底层路径；坏深度拒绝', async () => {
  const engine = new Hmr2Engine({ provider: 'cpu' });
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  engine.ready = true; engine.session = { run: async () => { await gate; return outputs(); }, release: async () => {} };
  const batch = prepared();
  const first = engine.runPrepared(batch.inputs, batch.metadata);
  await assert.rejects(engine.runPrepared({}, {}), (error) => error.status === 503 && error.code === 'gpu_busy');
  unblock(); await first;
  engine.session.run = async () => { throw new Error('secret-model-path'); };
  await assert.rejects(engine.runPrepared(batch.inputs, batch.metadata), (error) => error.code === 'inference_failed' && !error.message.includes('secret'));
  assert.equal(engine.busy, false);
  engine.session.run = async () => { const data = outputs(); data.cameraDepth.data[0] = -1; return data; };
  await assert.rejects(engine.runPrepared(batch.inputs, batch.metadata), /合同/);
  assert.equal(engine.busy, false);
  engine.session.run = async () => { const data = outputs(); data.cameraTranslation.data[2] = 0; return data; };
  await assert.rejects(engine.runPrepared(batch.inputs, batch.metadata), /合同/);
  engine.session.run = async () => { const data = outputs(); data.principalPointPx.data[0] = 0; return data; };
  await assert.rejects(engine.runPrepared(batch.inputs, batch.metadata), /主点/);
  await engine.close();

  let finishRun;
  const runGate = new Promise((resolve) => { finishRun = resolve; });
  let releases = 0;
  const activeEngine = new Hmr2Engine({ provider: 'cpu' });
  activeEngine.ready = true;
  activeEngine.session = { run: async () => { await runGate; return outputs(); },
    release: async () => { releases += 1; } };
  const running = activeEngine.runPrepared(batch.inputs, batch.metadata);
  assert.equal(activeEngine.busy, true);
  const stopping = activeEngine.close();
  assert.equal(activeEngine.ready, false);
  assert.equal(releases, 0);
  await assert.rejects(activeEngine.runPrepared(batch.inputs, batch.metadata),
    (error) => error.status === 503 && error.code === 'model_not_ready');
  finishRun();
  await running;
  await stopping;
  assert.equal(activeEngine.session, null);
  assert.equal(activeEngine.busy, false);
  assert.equal(releases, 1);
});

test('本机prepared bbox来源/范围/像素限额先invalid_batch，不调用session；help不受环境阻断，IPv6规范化', async () => {
  assert.deepEqual(parseServerArgs(['--help'], { HMR2_HOST: '0.0.0.0', HMR2_PROVIDER: 'invalid' }), { help: true });
  assert.equal(parseServerArgs(['--host', '[::1]'], {}).host, '::1');
  const engine = new Hmr2Engine({ provider: 'cpu' });
  let runs = 0;
  engine.ready = true; engine.session = { run: async () => { runs += 1; return outputs(); }, release: async () => {} };
  for (const change of [{ boxXYXY: undefined }, { boxXYXY: [0, 0, 5, 5] }, { bboxSource: 'other' }, { boxXYXY: [0, 0, 400, 240] }]) {
    const batch = prepared();
    await assert.rejects(engine.runPrepared(batch.inputs, { ...batch.metadata, ...change }), (error) => error.code === 'invalid_batch');
  }
  const batch = prepared();
  engine.options.maxPixels = 1;
  await assert.rejects(engine.runPrepared(batch.inputs, batch.metadata), (error) => error.code === 'invalid_batch');
  assert.equal(runs, 0); assert.equal(engine.busy, false);
  await engine.close();
});
