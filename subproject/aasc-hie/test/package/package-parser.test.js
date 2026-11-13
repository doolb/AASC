import { describe, expect, it } from 'vitest';
import { parseNavigationPackage } from '../../src/package/package-parser.js';

const fence = String.fromCharCode(96).repeat(3);
const image = Buffer.from('image').toString('base64');

describe('parseNavigationPackage', () => {
  it('parses navigation data, embedded image assets, NavMesh references, rules, and alerts', () => {
    const markdown = [
      '# Example package',
      '',
      fence + 'navigation-json',
      JSON.stringify({
        metadata: {
          id: 'example-package',
          version: '1.0.0',
          author: { kind: 'external-client', name: 'llm' },
          source: { url: 'https://example.test/rules', version: '1.x' },
        },
        rules: { hero: { movementSpeed: 300 } },
        alerts: [{
          id: 'enemy-nearby',
          when: 'distance(self, nearestEnemyHero) < 450',
          severity: 'warning',
          message: 'Enemy nearby',
          suggestedGoal: 'retreat',
        }],
        goals: [{ id: 'retreat', kind: 'map-2.5d', navmeshId: 'arena', target: { x: 1, z: 2 } }],
        navmeshes: [{ id: 'arena', file: 'maps/arena.navmesh', spaceModel: 'moba-25d' }],
      }),
      fence,
      '',
      `![hero-icon Hero icon](data:image/png;base64,${image})`,
    ].join('\n');

    const result = parseNavigationPackage(markdown, '/tmp/example.nav.md');

    expect(result).toMatchObject({
      sourcePath: '/tmp/example.nav.md',
      metadata: {
        id: 'example-package',
        author: { kind: 'external-client', name: 'llm' },
        source: { url: 'https://example.test/rules', version: '1.x' },
      },
      rules: { hero: { movementSpeed: 300 } },
      alerts: [expect.objectContaining({ id: 'enemy-nearby', suggestedGoal: 'retreat' })],
      navmeshes: [{ id: 'arena', file: 'maps/arena.navmesh', spaceModel: 'moba-25d' }],
    });
    expect(result.assets[0]).toMatchObject({
      id: 'hero-icon',
      mimeType: 'image/png',
      dataBase64: image,
      dataUri: `data:image/png;base64,${image}`,
    });
  });

  it('rejects invalid image data and unsafe NavMesh paths with the source path', () => {
    expect(() => parseNavigationPackage([
      fence + 'navigation-json',
      JSON.stringify({ metadata: { id: 'invalid-image' } }),
      fence,
      '![bad](data:image/png;base64,not valid!)',
    ].join('\n'), '/tmp/invalid-image.nav.md')).toThrow('/tmp/invalid-image.nav.md: invalid base64 image asset');

    expect(() => parseNavigationPackage([
      fence + 'navigation-json',
      JSON.stringify({
        metadata: { id: 'invalid-path' },
        navmeshes: [{ id: 'arena', file: '../outside.navmesh' }],
      }),
      fence,
    ].join('\n'), '/tmp/invalid-path.nav.md')).toThrow('/tmp/invalid-path.nav.md: invalid navmesh.file');
  });
});
