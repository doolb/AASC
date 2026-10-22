import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireModel, verifyModel } from '../core/model-files.mjs';
import { DEFAULT_MODEL_DIR, DEFAULT_LOCAL_SOURCE_DIR } from '../core/paths.mjs';
import { ServiceError } from '../core/errors.mjs';
import { ensureDependencies } from './prepare-deps.mjs';

export function parseDownloadArgs(args, env = process.env) {
  const result = { modelDir: env.HMR2_MODEL_DIR || DEFAULT_MODEL_DIR,
    sourceDir: env.HMR2_MODEL_SOURCE_DIR || DEFAULT_LOCAL_SOURCE_DIR,
    baseUrl: env.HMR2_MODEL_BASE_URL || '', help: false, verifyOnly: false };
  const fields = new Map([['--model-dir', 'modelDir'], ['--source-dir', 'sourceDir'], ['--base-url', 'baseUrl']]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') { result.help = true; continue; }
    if (argument === '--verify-only') { result.verifyOnly = true; continue; }
    const field = fields.get(argument);
    if (!field || !args[index + 1] || args[index + 1].startsWith('--')) throw new ServiceError(400, 'invalid_cli', '模型命令参数无效；查看 --help');
    result[field] = args[++index];
  }
  result.modelDir = path.resolve(result.modelDir);
  result.sourceDir = path.resolve(result.sourceDir);
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseDownloadArgs(args);
  if (options.help) {
    console.log('用法：npm run download:hmr2-model -- [--source-dir 本机候选目录] [--base-url HTTPS目录URL] [--model-dir 目标目录] [--verify-only]');
    console.log('默认从本机已生成候选校验导入；配置HMR2_MODEL_BASE_URL后真实远程下载。没有已验证官方下载URL，不自行发布模型。');
    return;
  }
  if (options.verifyOnly) {
    console.log(JSON.stringify(await verifyModel({ modelDir: options.modelDir }), null, 2));
    return;
  }
  await ensureDependencies();
  let lastProgress = 0;
  const result = await acquireModel({ ...options, onProgress: (event) => {
    if (Date.now() - lastProgress > 1000 || event.bytes === event.totalBytes) {
      console.log(`${event.source} ${event.file}: ${(event.bytes / 1024 / 1024).toFixed(1)} / ${(event.totalBytes / 1024 / 1024).toFixed(1)} MiB`);
      lastProgress = Date.now();
    }
  } });
  const labels = { cache: '已有缓存通过完整SHA验证', local: '本机校验导入完成（本次没有网络下载）', remote: '远程流式下载和完整SHA验证完成' };
  console.log(labels[result.source]);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    console.error(error instanceof ServiceError ? error.message : '模型准备失败；底层路径和URL已隐藏');
    process.exitCode = 1;
  }
}
