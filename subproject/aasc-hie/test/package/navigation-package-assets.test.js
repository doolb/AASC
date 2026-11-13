import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NavMeshStore } from '../../src/computation/navigation/navmesh-store.js';
import { NavigationPackageRepository } from '../../src/package/package-repository.js';
import { validateNavigationPackage } from '../../src/package/package-validator.js';

const root = resolve(import.meta.dirname, '../..');

describe('navigation package assets', () => {
  it('loads all current Markdown navigation packages', async () => {
    const packages = [
      {
        file: 'honor-of-kings.nav.md',
        id: 'honor-of-kings',
      },
      {
        file: 'netease-cloud-infinity-nikki.nav.md',
        id: 'netease-cloud-infinity-nikki-ui',
      },
      {
        file: 'tower-of-fantasy-weekly.nav.md',
        id: 'tower-of-fantasy-weekly-ui',
      },
    ];
    const repository = new NavigationPackageRepository({ dataRoot: resolve(root, 'data/test-package-assets') });

    for (const entry of packages) {
      const packagePath = resolve(root, 'data/packages', entry.file);
      const markdown = await readFile(packagePath, 'utf8');
      const navigationPackage = await repository.load(packagePath);
      const errors = validateNavigationPackage(navigationPackage).filter((diagnostic) => diagnostic.severity === 'error');

      expect(navigationPackage.metadata.id).toBe(entry.id);
      expect(navigationPackage.scenarios.every((scenario) => typeof scenario.id === 'string')).toBe(true);
      expect(navigationPackage.assets.length).toBeGreaterThan(0);
      expect(errors).toEqual([]);
      expect(markdown).toContain('navigation-json');
    }
  });

  it('loads independent NavMesh documents without replacing the current sample map', async () => {
    const store = new NavMeshStore({ rootDir: resolve(root, 'data/navmesh/maps') });
    const maps = [
      'legacy-honor-of-kings-25d',
      'infinity-nikki-world-static',
      'infinity-nikki-world-yolo-test',
    ];

    for (const mapId of maps) {
      const navmesh = await store.load(mapId);
      expect(navmesh.mapId).toBe(mapId);
      expect(navmesh.revision).toBeGreaterThan(0);
      expect(navmesh.tiles.length).toBeGreaterThan(0);
    }

    const currentSample = await store.load('honor-of-kings-25d');
    expect(currentSample.mapId).toBe('honor-of-kings-25d');
  });

  it('loads model registrations and progress snapshots', async () => {
    const yolo = JSON.parse(await readFile(resolve(root, 'data/models/legacy/yolo-models.json'), 'utf8'));
    const depth = JSON.parse(await readFile(resolve(root, 'data/models/legacy/anydepth-models.json'), 'utf8'));
    const progressFiles = [
      'infinity-nikki-daily-routine-2026-09-03.json',
      'infinity-nikki-daily-inspiration-2026-09-03.json',
      'infinity-nikki-daily-inspiration-2026-09-04.json',
      'tower-of-fantasy-weekly-panel-2026-W36.json',
    ];

    expect(yolo.models).toHaveLength(2);
    expect(depth.models).toHaveLength(2);
    for (const file of progressFiles) {
      const progress = JSON.parse(await readFile(resolve(root, 'data/progress/legacy', file), 'utf8'));
      expect(progress.targetId).toBeTruthy();
      expect(progress.periodKey).toBeTruthy();
      expect(progress.updatedAt).toBeTruthy();
    }
  });
});
