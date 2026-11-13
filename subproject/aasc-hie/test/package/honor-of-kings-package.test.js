import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NavigationPackageRepository } from '../../src/package/package-repository.js';
import { validateNavigationPackage } from '../../src/package/package-validator.js';

const root = resolve(import.meta.dirname, '../..');

describe('Honor of Kings recognition package', () => {
  it('loads reviewed screen states and does not request actions or NavMesh data', async () => {
    const packagePath = resolve(root, 'data/packages/honor-of-kings.nav.md');
    const repository = new NavigationPackageRepository({ dataRoot: resolve(root, 'data/test-migration') });
    const navigationPackage = await repository.load(packagePath);
    const manifestPath = resolve(root, 'data/datasets/honor-of-kings/manifest.jsonl');
    const records = (await readFile(manifestPath, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const reviewedRecords = records.filter((record) => record.annotationStatus.startsWith('screen-reviewed'));

    expect(navigationPackage.metadata).toMatchObject({
      id: 'honor-of-kings',
      version: 'recognition-0.2.0',
      packageName: 'com.tencent.tmgp.sgame',
      navigators: ['recognition'],
    });
    expect(navigationPackage.stateRecognition).toMatchObject({
      mode: 'observe-only',
      frameSize: { width: 1480, height: 720 },
      dataset: { reviewedSampleCount: 31 },
      capture: { preferred: { method: 'adb-screenrecord-h264', outputFramesPerSecond: 2 } },
    });
    expect(navigationPackage.states).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'hok-home', sampleIds: ['home-lobby-live'] }),
      expect.objectContaining({ id: 'hok-battle-hud', sampleIds: ['battle-hud-live'] }),
      expect.objectContaining({ id: 'hok-battle-scoreboard' }),
      expect.objectContaining({ id: 'hok-result-scoreboard' }),
    ]));
    expect(navigationPackage.goals).toEqual([]);
    expect(navigationPackage.flows).toEqual([]);
    expect(navigationPackage.navmeshes).toEqual([]);
    expect(reviewedRecords).toHaveLength(31);
    expect(reviewedRecords.every((record) => record.width === 1480 && record.height === 720)).toBe(true);
    expect(reviewedRecords.every((record) => record.sceneId && record.uis.length > 0)).toBe(true);
    expect(validateNavigationPackage(navigationPackage).filter((entry) => entry.severity === 'error')).toEqual([]);
  });

  it('keeps game identifiers out of shared navigation algorithms', async () => {
    const files = [
      'src/computation/navigation/map-navigator.js',
      'src/computation/navigation/pathfinder.js',
      'src/computation/battle-simulator.js',
    ];
    for (const file of files) {
      const source = await readFile(resolve(root, file), 'utf8');
      expect(source).not.toContain('honor-of-kings');
      expect(source).not.toContain('training-spawn');
    }
  });
});
