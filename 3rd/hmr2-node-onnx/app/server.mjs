import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createService, validateHttpOptions } from '../framework/http-service.mjs';
import { DEFAULT_MODEL_DIR, DEFAULT_PORT, PACKAGE_ROOT } from '../core/paths.mjs';
import { ServiceError } from '../core/errors.mjs';
import { verifyModel } from '../core/model-files.mjs';
import { ensureDependencies } from './prepare-deps.mjs';

export function parseServerArgs(args, env = process.env) {
  if (args.includes('--help')) return { help: true };
  const values = { host: env.HMR2_HOST || '127.0.0.1', port: env.HMR2_PORT || DEFAULT_PORT,
    apiToken: env.HMR2_API_TOKEN || '', corsOrigins: (env.HMR2_CORS_ORIGINS || '').split(',').filter(Boolean),
    modelDir: env.HMR2_MODEL_DIR || DEFAULT_MODEL_DIR, provider: env.HMR2_PROVIDER || (process.platform === 'win32' ? 'dml' : 'cpu'),
    deviceId: env.HMR2_DML_DEVICE_ID || 0, intraOpNumThreads: 4, maxRequestBytes: 24 * 1024 * 1024,
    maxImageBytes: 16 * 1024 * 1024, maxPixels: 40_000_000, maxBlurPixels: 12_000_000, maxBlurRadius: 64,
    check: false, help: false };
  const fields = new Map([['--host', 'host'], ['--port', 'port'], ['--token', 'apiToken'], ['--model-dir', 'modelDir'],
    ['--provider', 'provider'], ['--device-id', 'deviceId'], ['--threads', 'intraOpNumThreads'],
    ['--max-image-bytes', 'maxImageBytes'], ['--max-pixels', 'maxPixels'], ['--max-request-bytes', 'maxRequestBytes'],
    ['--max-blur-pixels', 'maxBlurPixels'], ['--max-blur-radius', 'maxBlurRadius']]);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--help') { values.help = true; continue; }
    if (args[i] === '--check') { values.check = true; continue; }
    if (args[i] === '--cors-origin' && args[i + 1]) { values.corsOrigins.push(args[++i]); continue; }
    const key = fields.get(args[i]);
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new ServiceError(400, 'invalid_cli', '启动参数无效；查看 --help');
    values[key] = args[++i];
  }
  for (const key of ['port', 'deviceId', 'intraOpNumThreads', 'maxRequestBytes', 'maxImageBytes', 'maxPixels', 'maxBlurPixels', 'maxBlurRadius']) {
    if (!/^[0-9]+$/.test(String(values[key]))) throw new ServiceError(400, 'invalid_config', key + '必须为整数');
    values[key] = Number(values[key]);
    if (!Number.isSafeInteger(values[key])) throw new ServiceError(400, 'invalid_config', key + '超出安全整数范围');
  }
  if (values.port > 65535 || values.deviceId > 15 || values.intraOpNumThreads < 1 || values.intraOpNumThreads > 32 ||
    values.maxBlurPixels < 1 || values.maxBlurRadius < 1 || !['dml', 'cpu'].includes(values.provider)) {
    throw new ServiceError(400, 'invalid_config', '端口、线程、DML ordinal、Gaussian预算或provider无效');
  }
  values.modelDir = path.resolve(values.modelDir);
  values.host = values.host.replace(/^\[([^\]]+)\]$/, '$1');
  try { return { ...values, ...validateHttpOptions(values) }; } catch {
    throw new ServiceError(400, 'invalid_config', '监听/鉴权/CORS/限额配置无效；非loopback必须token');
  }
}

// 仅显式CLI启动调用；普通import不初始化模型、不监听、不控制任何已有服务器。
export async function main(args = process.argv.slice(2)) {
  const options = parseServerArgs(args);
  if (options.help) {
    console.log('npm run start:hmr2 -- [--host 127.0.0.1] [--port 8769] [--provider dml|cpu] [--model-dir 目录] [--check]');
    console.log('默认独立Windows DML；不替换原Python8768。非loopback必须HMR2_API_TOKEN，跨源使用--cors-origin明确Origin。');
    console.log('--check只校验配置和模型SHA，不加载GPU/监听；先npm run download:hmr2-model准备模型。');
    return;
  }
  if (options.check) {
    const model = await verifyModel({ modelDir: options.modelDir });
    console.log(JSON.stringify({ configValid: true, modelVerified: model.verified, modelDir: model.modelDir,
      provider: options.provider, port: options.port, listenerStarted: false, modelLoaded: false }, null, 2));
    return;
  }
  await ensureDependencies();
  const { Hmr2Engine } = await import('../framework/engine.mjs');
  const engine = new Hmr2Engine(options);
  const server = createService({ engine, options, assets: { testPagePath: path.join(PACKAGE_ROOT, 'public/index.html'),
    threeModulePath: path.join(PACKAGE_ROOT, 'public/hmr2-three.js') } });
  try {
    // 先占用自己的监听端口，碰到冲突即退出，避免先加载第二份6GB显存大模型。
    server.listen(options.port, options.host);
    await once(server, 'listening');
    await engine.load();
    const address = server.address();
    const host = options.host.includes(':') ? `[${options.host}]` : options.host;
    console.log(`HMR2 Node ONNX就绪：http://${host}:${address.port} （${engine.deviceInfo().device}，FP32 I/O；内部精度unknown）`);
    console.log('原Python与页面未替换。模型保持单session，忙态503。Ctrl+C关闭本次用户启动的实例。');
  } catch (error) {
    if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    await engine.close();
    throw error;
  }
  const close = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await engine.close();
  };
  // 用户执行本CLI后的正常Ctrl+C清理；AI测试不向用户PID发送信号。
  process.once('SIGINT', () => { void close().catch(() => { process.exitCode = 1; }); });
  process.once('SIGTERM', () => { void close().catch(() => { process.exitCode = 1; }); });
  return { server, engine };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    console.error(error instanceof ServiceError ? error.message : 'Node服务启动失败；端口冲突或底层路径已隐藏');
    process.exitCode = 1;
  }
}
