import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScriptMaintenance } from '../../src/runtime/script-maintenance.js';

const dirs = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'hie-maintenance-'));
  dirs.push(root);
  await mkdir(join(root, 'scripts'));
  await writeFile(join(root, 'scripts', 'task.js'), 'export const value = 1;\n');
  return root;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('HIE 脚本维护', () => {
  it('校验摘要并在两项检查通过后保留更新', async () => {
    const root = await setup();
    const check = vi.fn(async () => {});
    const editor = new ScriptMaintenance({ root, check });
    const source = await editor.read('task.js');
    await expect(editor.update({ name: 'task.js', sha256: source.sha256, content: 'export const value = 2;\n' })).resolves.toMatchObject({ checked: true });
    expect(check.mock.calls.map(call => call[0])).toEqual(['node', 'npm']);
    expect(await readFile(join(root, 'scripts', 'task.js'), 'utf8')).toContain('2');
    await expect(editor.update({ name: 'task.js', sha256: source.sha256, content: 'changed' })).rejects.toThrow('摘要');
  });

  it('测试失败恢复原内容，路径穿越和符号链接被拒绝', async () => {
    const root = await setup();
    await symlink(join(root, 'scripts', 'task.js'), join(root, 'scripts', 'link.js'));
    const editor = new ScriptMaintenance({ root, check: async () => { throw new Error('test failed'); } });
    const source = await editor.read('task.js');
    await expect(editor.update({ ...source, content: 'bad' })).rejects.toThrow('test failed');
    expect(await readFile(join(root, 'scripts', 'task.js'), 'utf8')).toBe(source.content);
    await expect(editor.read('../task.js')).rejects.toThrow();
    await expect(editor.read('link.js')).rejects.toThrow();
  });
});
