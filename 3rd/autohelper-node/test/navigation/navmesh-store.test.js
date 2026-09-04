import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NavMeshStore } from '../../src/navigation/navmesh-store.js';

const tempDirectory = async () => mkdtemp(join(tmpdir(), 'autohelper-navmesh-'));

describe('NavMeshStore', () => {
  it('saves and reloads dynamic tiles independently from the Markdown package', async () => {
    const root = await tempDirectory();
    const packagePath = join(root, 'game.nav.md');
    await writeFile(packagePath, 'package-content');
    const store = new NavMeshStore({
      rootDir: root,
      now: () => '2026-09-04T00:00:00.000Z',
    });
    const tile = {
      id: 'tile-0',
      version: 1,
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      polygons: [{ id: 'road-0', vertices: [0, 1], region: 'walkable' }],
      confidence: 0.88,
    };

    const saved = await store.upsertTile('world', tile, 0);
    const loaded = await store.load('world');

    expect(saved).toMatchObject({ mapId: 'world', revision: 1, tiles: [tile] });
    expect(loaded).toEqual(saved);
    expect(await readFile(packagePath, 'utf8')).toBe('package-content');
    expect(await readFile(join(root, 'world.navmesh'), 'utf8')).toContain('"tile-0"');
  });

  it('rejects stale revisions and leaves the current mesh unchanged', async () => {
    const root = await tempDirectory();
    const store = new NavMeshStore({ rootDir: root });
    const tile = {
      id: 'tile-0',
      version: 1,
      vertices: [],
      polygons: [],
    };
    await store.upsertTile('world', tile, 0);

    await expect(store.upsertTile('world', { ...tile, version: 2 }, 0))
      .rejects.toMatchObject({ code: 'NAVMESH_REVISION_CONFLICT' });
    await expect(store.load('world')).resolves.toMatchObject({
      revision: 1,
      tiles: [{ id: 'tile-0', version: 1 }],
    });
  });
});
