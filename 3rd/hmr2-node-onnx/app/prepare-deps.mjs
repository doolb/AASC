import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { PACKAGE_ROOT } from '../core/paths.mjs';
import { ServiceError } from '../core/errors.mjs';

// 两个用户npm命令可首用准备独立依赖；只使用子包lock，绝不向根生产依赖添ORT。
export async function ensureDependencies() {
  const manifest = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  let complete = true;
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    try {
      const installed = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'node_modules', name, 'package.json'), 'utf8'));
      if (installed.version !== version) complete = false;
    } catch { complete = false; }
  }
  if (complete) return;
  let npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  try { await access(npmCli); } catch {
    throw new ServiceError(503, 'dependencies_missing', '请先运行 npm ci --prefix 3rd/hmr2-node-onnx 安装独立依赖');
  }
  console.log('首次准备HMR2独立Node依赖（仅3rd子包）…');
  // inherit避免捕获子进程stdio的named-pipe边界，参数数组不拼接shell命令。
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, 'ci', '--prefix', PACKAGE_ROOT, '--no-audit', '--no-fund'], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) throw new ServiceError(503, 'dependencies_install_failed', '独立Node依赖安装失败；未运行模型');
}
