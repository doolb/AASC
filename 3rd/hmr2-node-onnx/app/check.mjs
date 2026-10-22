import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PACKAGE_ROOT } from '../core/paths.mjs';

async function run(arguments_) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, { cwd: PACKAGE_ROOT, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error('Node静态检查/CPU自测失败：' + code);
}

try {
  const tests = [];
  for (const dir of ['core', 'framework', 'app']) {
    for (const name of await readdir(path.join(PACKAGE_ROOT, dir))) {
      if (!name.endsWith('.mjs')) continue;
      const file = path.join(dir, name);
      await run(['--check', file]);
      if (name.endsWith('.test.mjs')) tests.push(file);
    }
  }
  await run(['--test', '--test-concurrency=1', ...tests]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
