import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { Hmr2Engine } from '../framework/engine.mjs';
import { createService } from '../framework/http-service.mjs';
import { PACKAGE_ROOT } from '../core/paths.mjs';

// 普通自有port0完整图集成测试，不启动用户8769；默认CPU，DML必须显式并有显存窗口。
const [caseFile, outputFile, requestedProvider = 'cpu'] = process.argv.slice(2);
if (!caseFile || !outputFile || !['cpu', 'dml'].includes(requestedProvider)) throw new Error('node app/test-service-integration.mjs cases.json new-report.json [cpu|dml]');
const cases = JSON.parse(await readFile(caseFile, 'utf8'));
const engine = new Hmr2Engine({ provider: requestedProvider });
const server = createService({ engine, options: { host: '127.0.0.1' }, assets: {
  testPagePath: path.join(PACKAGE_ROOT, 'public/index.html'), threeModulePath: path.join(PACKAGE_ROOT, 'public/hmr2-three.js') } });
const records = [];
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const cold = await (await fetch(url + '/health')).json();
  if (cold.ready !== false) throw new Error('cold health不应加载模型');
  await engine.load();
  const ready = await (await fetch(url + '/health')).json();
  if (!ready.ready || ready.loadCount !== 1) throw new Error('完整模型必须只加载一次');
  const page = await fetch(url + '/');
  const html = await page.text();
  if (page.status !== 200 || html.includes('__HMR_NONCE__') || !page.headers.get('content-security-policy')) throw new Error('真实页面nonce/CSP失败');
  const three = await fetch(url + '/hmr2-three.js');
  if (three.status !== 200 || !(await three.arrayBuffer()).byteLength) throw new Error('本地Three失败');
  for (const sample of cases.slice(0, 4)) {
    const bytes = await readFile(sample.imagePath);
    const payload = { image_base64: bytes.toString('base64') };
    if (sample.bbox !== undefined) payload.bbox_xyxy = sample.bbox;
    const start = performance.now();
    const response = await fetch(url + '/infer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (response.status !== 200 || result.type !== 'hmr2.result' || result.runtime.modelVerified !== true || result.cameraTranslation[2] <= 0) {
      throw new Error('完整ONNX HTTP推理失败：' + JSON.stringify(result.error ?? { status: response.status }));
    }
    records.push({ name: sample.name, httpStatus: response.status, clientRoundtripMs: performance.now() - start,
      result });
  }
  const final = await (await fetch(url + '/health')).json();
  if (final.busy || final.loadCount !== 1) throw new Error('会话复用/忙锁状态无效');
  await mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
  await writeFile(outputFile, JSON.stringify({ scope: `真实完整ONNX ${requestedProvider} session和自有port0 HTTP；不是GPU真值准度/性能统计`,
    createdAt: new Date().toISOString(), requestedProvider, cold, ready, final, records }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output: path.resolve(outputFile), requestedProvider, completeModelLoaded: true,
    inferenceCount: records.length, loadCount: final.loadCount, actualAssignment: final.runtime.actualAssignment }));
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await engine.close();
}
