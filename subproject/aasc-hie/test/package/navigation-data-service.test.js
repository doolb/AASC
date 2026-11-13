import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NavigationDataService } from '../../src/package/navigation-data-service.js';
import { NavigationPackageRepository } from '../../src/package/package-repository.js';

const roots = [];
const fence = String.fromCharCode(96).repeat(3);

const packageMarkdown = [
  fence + 'navigation-json',
  JSON.stringify({
    metadata: { id: 'contract-package', version: '1.0.0' },
    rules: { hero: { movementSpeed: 300 } },
    goals: [{ id: 'retreat', kind: 'ui' }],
    alerts: [{ id: 'retreat-alert', suggestedGoal: 'retreat' }],
  }),
  fence,
].join('\n');
const provenance = { url: 'https://example.test/source', version: '1.x' };

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }));
  }));
});

describe('NavigationDataService', () => {
  it('rejects stale revisions and applies the same mutation contract for external clients', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aasc-hie-package-'));
    roots.push(root);
    const packagePath = join(root, 'contract-package.nav.md');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(packagePath, packageMarkdown));

    const repository = new NavigationPackageRepository({ dataRoot: join(root, 'data') });
    await repository.load(packagePath);
    const service = new NavigationDataService({ repository });

    await expect(service.apply('contract-package', {
      author: { kind: 'external-client', name: 'llm' },
      source: { url: 'https://www.honorofkings.com/zh-CN/experience.html', version: '9.x' },
      baseRevision: 2,
      operations: [{ op: 'add', path: '/rules/hero/movementSpeed', value: 350 }],
    })).rejects.toThrow(/baseRevision|revision/i);

    const revision = await service.apply('contract-package', {
      author: { kind: 'external-client', name: 'llm' },
      source: { url: 'https://www.honorofkings.com/zh-CN/experience.html', version: '9.x' },
      baseRevision: 0,
      operations: [{ op: 'replace', path: '/rules/hero/movementSpeed', value: 350 }],
    });

    expect(revision).toMatchObject({
      packageId: 'contract-package',
      revision: 1,
      baseRevision: 0,
      package: { rules: { hero: { movementSpeed: 350 } } },
      metadata: {
        author: { kind: 'external-client', name: 'llm' },
        source: { version: '9.x' },
      },
    });
    expect(await readFile(join(root, 'data/packages/contract-package/revisions/1.json'), 'utf8'))
      .toContain('"movementSpeed": 350');
  });

  it('keeps candidate revisions out of the active package until publish validates them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aasc-hie-publish-'));
    roots.push(root);
    const packagePath = join(root, 'contract-package.nav.md');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(packagePath, packageMarkdown));

    const repository = new NavigationPackageRepository({ dataRoot: join(root, 'data') });
    await repository.load(packagePath);
    const service = new NavigationDataService({ repository });
    const revision = await service.apply('contract-package', {
      author: { kind: 'human', name: 'operator' },
      source: provenance,
      baseRevision: 0,
      operations: [{ op: 'add', path: '/rules/hero/armor', value: 10 }],
    });

    expect(repository.package('contract-package').rules.hero.armor).toBeUndefined();
    expect(repository.currentRevision('contract-package')).toBe(0);
    await expect(stat(join(root, 'data/packages/contract-package/active.json'))).rejects.toThrow();
    const published = await service.publish('contract-package', revision);

    expect(published).toMatchObject({
      packageId: 'contract-package',
      revision: 1,
      package: { rules: { hero: { armor: 10 } } },
    });
    expect(JSON.parse(await readFile(join(root, 'data/packages/contract-package/active.json'), 'utf8')))
      .toMatchObject({ rules: { hero: { armor: 10 } } });
  });

  it('rejects forged or incomplete revision envelopes at service and repository publication boundaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aasc-hie-envelope-'));
    roots.push(root);
    const packagePath = join(root, 'contract-package.nav.md');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(packagePath, packageMarkdown));
    const repository = new NavigationPackageRepository({ dataRoot: join(root, 'data') });
    await repository.load(packagePath);
    const service = new NavigationDataService({ repository });
    const revision = await service.apply('contract-package', {
      author: { kind: 'script', name: 'builder' },
      source: provenance,
      baseRevision: 0,
      operations: [{ op: 'replace', path: '/rules/hero/movementSpeed', value: 350 }],
    });

    const diagnostics = service.validate('contract-package', revision);
    expect(diagnostics).not.toBeInstanceOf(Promise);
    expect(diagnostics).toEqual([]);
    const numericDiagnostics = service.validate('contract-package', 1);
    expect(numericDiagnostics).toBeInstanceOf(Promise);
    await expect(numericDiagnostics).resolves.toEqual([]);
    await expect(service.validateStored('contract-package', 1)).resolves.toEqual([]);

    await expect(service.publish('contract-package', {
      ...revision,
      revision: 900,
    })).rejects.toThrow(/canonical|revision|stored|envelope/i);
    expect(() => service.validate('contract-package', {
      ...revision,
      packageId: 'other-package',
    })).toThrow(/packageId|association|match|canonical/i);
    await expect(service.publish('contract-package', {
      packageId: 'contract-package',
      revision: 1,
      baseRevision: 0,
      package: revision.package,
      metadata: { author: { kind: 'script', name: 'builder' } },
    })).rejects.toThrow(/source|provenance|canonical|revision/i);
    await expect(repository.publishRevision('contract-package', {
      packageId: 'contract-package',
      revision: 1,
      baseRevision: 0,
      package: revision.package,
    })).rejects.toThrow(/author|source|metadata|canonical|revision/i);
  });

  it('rejects unsafe mutation operations without evaluating expressions or paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aasc-hie-safe-'));
    roots.push(root);
    const packagePath = join(root, 'contract-package.nav.md');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(packagePath, packageMarkdown));
    const repository = new NavigationPackageRepository({ dataRoot: join(root, 'data') });
    await repository.load(packagePath);
    const service = new NavigationDataService({ repository });
    const request = (operation) => service.apply('contract-package', {
      author: { kind: 'script', name: 'test' },
      source: provenance,
      baseRevision: 0,
      operations: [operation],
    });

    await expect(request({ op: 'eval', path: '/rules/x', value: 'process.exit()' }))
      .rejects.toThrow(/operation|unsupported/i);
    await expect(request({ op: 'add', path: '/../outside', value: 1 }))
      .rejects.toThrow(/pointer|path|unsafe/i);
    await expect(request({ op: 'add', path: '/__proto__/polluted', value: true }))
      .rejects.toThrow(/unsafe|pointer|path/i);
  });
});
