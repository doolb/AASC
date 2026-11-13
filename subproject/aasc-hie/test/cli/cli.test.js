import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../../src/cli.js';

describe('CLI', () => {
  it('defaults device execution to dry-run and supports explicit enablement', () => {
    expect(parseCliArgs(['nav-serve', '--package', 'demo'])).toMatchObject({ command: 'nav-serve', packageId: 'demo', dryRun: true, enableExecution: false });
    expect(parseCliArgs(['nav-serve', '--enable-execution'])).toMatchObject({ dryRun: false, enableExecution: true });
  });

  it('parses package and map command inputs without creating a special client mode', () => {
    expect(parseCliArgs(['nav-map-build', '--package', 'demo', '--map', 'arena', '--file', 'observations.json'])).toMatchObject({ command: 'nav-map-build', packageId: 'demo', mapId: 'arena', file: 'observations.json' });
    expect(parseCliArgs(['nav-chain', '--file', 'data/packages/example.nav.md', '--goal-id', 'demo-goal'])).toMatchObject({ command: 'nav-chain', file: 'data/packages/example.nav.md', goalId: 'demo-goal' });
  });

  it('parses an externally selected runtime goal command', () => {
    expect(parseCliArgs(['nav-goal', 'set', '--goal-id', 'daily-inspiration'])).toMatchObject({ command: 'nav-goal', action: 'set', goalId: 'daily-inspiration' });
  });

  it('uses the runtime chain interface for active-goal previews', async () => {
    const result = await (await import('../../src/cli.js')).runCli(['nav-chain'], { runtime: { getChain: async (options) => ({ goalId: options.goalId ?? 'active' }) } });
    expect(result).toEqual({ goalId: 'active' });
  });
});
