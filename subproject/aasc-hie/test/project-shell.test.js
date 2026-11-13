import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AASC-HIE project shell', () => {
  it('declares the project contract and ESM package', async () => {
    const root = resolve(import.meta.dirname, '..');
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

    expect(packageJson.type).toBe('module');
    expect(packageJson.scripts).toMatchObject({
      build: 'node --check src/index.js',
      test: 'vitest run',
      'test:watch': 'vitest',
      start: 'node src/index.js',
      'nav-check': 'node src/cli.js nav-check',
      'nav-chain': 'node src/cli.js nav-chain',
      'nav-serve': 'node src/cli.js nav-serve',
      'nav-map-build': 'node src/cli.js nav-map-build',
    });

    for (const directory of [
      'src/recognition',
      'src/computation',
      'src/execution',
      'src/package',
      'src/runtime',
      'src/server',
      'data/packages',
      'data/navmesh',
      'data/models',
      'data',
      'test',
    ]) {
      expect(existsSync(resolve(root, directory))).toBe(true);
    }

    const { createApplication } = await import(resolve(root, 'src/index.js'));
    expect(createApplication).toBeTypeOf('function');
  });

  it('resolves every declared navigation command with a shell status', () => {
    const root = resolve(import.meta.dirname, '..');
    const commands = ['nav-check', 'nav-chain', 'nav-serve', 'nav-map-build'];

    for (const command of commands) {
      const result = spawnSync(process.execPath, [resolve(root, 'src/cli.js'), command], {
        cwd: root,
        encoding: 'utf8',
      });

      expect(result.status, `${command} exit status`).toBe(0);
      expect(result.stdout, `${command} output`).toContain('requires configured application dependencies');
    }
  });

  it('prints a clear start status while keeping imports side-effect free', () => {
    const root = resolve(import.meta.dirname, '..');
    const entrypoint = resolve(root, 'src/index.js');
    const startResult = spawnSync(process.execPath, [entrypoint], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(startResult.status).toBe(0);
    expect(startResult.stdout.trim()).toBe(
      'AASC-HIE hierarchical autonomy engine ready.',
    );

    const importResult = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', `import ${JSON.stringify(entrypoint)};`],
      { cwd: root, encoding: 'utf8' },
    );

    expect(importResult.status).toBe(0);
    expect(importResult.stdout).toBe('');
  });
});
