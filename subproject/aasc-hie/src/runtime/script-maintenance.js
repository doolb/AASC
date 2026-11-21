import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');

/** 只修改 scripts 下已存在的普通 JS 文件；失败时不覆盖其他进程的新修改。 */
export class ScriptMaintenance {
  constructor({ root = defaultRoot, check = runCheck } = {}) {
    this.root = root;
    this.check = check;
    this.busy = false;
  }

  async file(name) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.js$/.test(name)) throw new Error('无效脚本名称');
    const path = join(this.root, 'scripts', name);
    if (!(await lstat(path)).isFile()) throw new Error('脚本必须是普通文件');
    return path;
  }

  async list() {
    const entries = await readdir(join(this.root, 'scripts'), { withFileTypes: true });
    return entries.filter(entry => entry.isFile() && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.js$/.test(entry.name)).map(entry => entry.name).sort();
  }

  async read(name) {
    const content = await readFile(await this.file(name), 'utf8');
    if (Buffer.byteLength(content) > 200000) throw new Error('脚本过大');
    return { name, content, sha256: digest(content) };
  }

  async update({ name, sha256, content }) {
    if (this.busy) throw new Error('脚本更新正在进行');
    if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > 200000) throw new Error('脚本内容无效');
    this.busy = true;
    let original;
    let path;
    let applied = false;
    try {
      path = await this.file(name);
      const mode = (await lstat(path)).mode;
      original = await readFile(path, 'utf8');
      if (digest(original) !== sha256) throw new Error('脚本摘要不匹配，请重新读取');
      await this.replace(path, content, mode);
      applied = true;
      await this.check('node', ['--check', path], this.root);
      // 这两组依赖未随仓库分发的数据集和导航资源，其余回归均须通过。
      await this.check('npm', ['test', '--', '--exclude', 'test/package/honor-of-kings-package.test.js', '--exclude', 'test/package/navigation-package-assets.test.js'], this.root);
      if (digest(await readFile(path, 'utf8')) !== digest(content)) throw new Error('测试期间脚本被其他进程修改');
      return { name, sha256: digest(content), checked: true };
    } catch (error) {
      if (applied) {
        if (digest(await readFile(path, 'utf8')) === digest(content)) {
          await this.replace(path, original, (await lstat(path)).mode);
        } else {
          throw new Error(`更新失败且脚本已被其他进程修改，未覆盖：${error.message}`);
        }
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async replace(path, content, mode) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { flag: 'wx', mode });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}

function runCheck(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-4000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`脚本检查失败 (${code ?? signal})：${output}`));
    });
  });
}
