import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNavigationPackage } from '../../src/package/package-parser.js';
import { validateNavigationPackage } from '../../src/package/package-validator.js';

const validPackage = {
  sourcePath: '/tmp/example.nav.md',
  metadata: { id: 'example-package', navigators: ['map-2.5d'] },
  scenarios: [],
  goals: [{ id: 'retreat', kind: 'map-2.5d', navmeshId: 'arena', target: { x: 1, z: 2 } }],
  states: [],
  flows: [],
  navmeshes: [{ id: 'arena', file: 'maps/arena.navmesh', spaceModel: 'moba-25d' }],
  assets: [],
  rules: {},
  alerts: [{ id: 'retreat-alert', suggestedGoal: 'retreat' }],
};

describe('validateNavigationPackage', () => {
  it('accepts the complete checked-in example navigation package', async () => {
    const filePath = resolve(import.meta.dirname, '../../data/packages/example.nav.md');
    const navigationPackage = parseNavigationPackage(await readFile(filePath, 'utf8'), filePath);

    expect(validateNavigationPackage(navigationPackage)).toEqual([]);
    expect(navigationPackage.goals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'daily-routine', steps: expect.arrayContaining([
        expect.objectContaining({ id: 'open-routine', flowId: 'open-routine' }),
        expect.objectContaining({ id: 'finish-routine', flowId: 'finish-routine' }),
      ]) }),
    ]));
  });

  it('accepts a package with valid goal, alert, and NavMesh references', () => {
    expect(validateNavigationPackage(validPackage)).toEqual([]);
  });

  it('reports invalid package IDs, revision integers, goal references, and NavMesh references', () => {
    const diagnostics = validateNavigationPackage({
      ...validPackage,
      metadata: { id: '../unsafe' },
      revision: 1.5,
      goals: [{ id: 'retreat', kind: 'map-2.5d', navmeshId: 'missing', flowId: 'missing-flow' }],
      alerts: [{ id: 'alert', suggestedGoal: 'missing-goal' }],
      navmeshes: [{ id: 'arena', file: '../outside.navmesh' }],
    });

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-package-id', severity: 'error' }),
      expect.objectContaining({ code: 'invalid-revision', severity: 'error' }),
      expect.objectContaining({ code: 'missing-reference', severity: 'error' }),
      expect.objectContaining({ code: 'missing-navmesh', severity: 'error' }),
      expect.objectContaining({ code: 'invalid-navmesh-file', severity: 'error' }),
    ]));
  });

  it('reports malformed IDs and Base64 image data introduced by a mutation', () => {
    const diagnostics = validateNavigationPackage({
      ...validPackage,
      goals: [{ id: '../unsafe-goal', kind: 'ui' }],
      assets: [
        { id: 'icon', dataUri: 'data:image/png;base64,not valid!' },
        { id: 'missing-data', url: 'https://example.test/icon.png' },
      ],
    });

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-goal-id', severity: 'error' }),
      expect.objectContaining({ code: 'invalid-image', severity: 'error' }),
    ]));
    expect(diagnostics.filter((item) => item.code === 'invalid-image')).toHaveLength(2);
  });
});
