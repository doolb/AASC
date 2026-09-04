import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  checkNavigationPackage,
  resolveNavigationPackageChain,
} from '../../src/tools/navigation-check.js';

const packageContent = () => {
  const fence = String.fromCharCode(96).repeat(3);
  return [
    fence + 'navigation-json',
    JSON.stringify({
      metadata: { id: 'game' },
      goals: [{ id: 'reach', kind: 'ui', flowId: 'flow' }],
      flows: [{
        id: 'flow',
        navigator: 'ui',
        steps: [
          { id: 'tap', kind: 'action', goto: 'done' },
          { id: 'done', kind: 'terminal', terminal: true },
        ],
      }],
    }),
    fence,
  ].join('\n');
};

describe('navigation-check tools', () => {
  it('checks a package and returns its static graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autohelper-nav-check-'));
    const filePath = join(root, 'game.nav.md');
    await writeFile(filePath, packageContent());

    const report = await checkNavigationPackage(filePath);

    expect(report.packageId).toBe('game');
    expect(report.diagnostics).toEqual([]);
    expect(report.staticGraph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'flow:flow:done', terminal: true }),
    ]));
  });

  it('returns the runtime chain without executing an instruction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autohelper-nav-chain-'));
    const filePath = join(root, 'game.nav.md');
    await writeFile(filePath, packageContent());

    const chain = await resolveNavigationPackageChain(filePath, 'reach', {});

    expect(chain.nodeIds).toEqual([
      'goal:reach',
      'flow:flow:tap',
      'flow:flow:done',
    ]);
    expect(chain.terminal).toBe(true);
  });
});
