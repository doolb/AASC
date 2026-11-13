import { describe, expect, it } from 'vitest';
import { RuntimeSession } from '../../src/runtime/runtime-session.js';

describe('RuntimeSession', () => {
  it('keeps a serializable runtime snapshot and records the last tick', () => {
    const session = new RuntimeSession({ id: 'session-1', packageId: 'demo' });
    session.record({ stateVersion: 2, observedAt: 100, selectedId: 'escape' });
    const snapshot = session.snapshot();

    expect(snapshot).toMatchObject({ id: 'session-1', packageId: 'demo', tickCount: 1, last: { stateVersion: 2, selectedId: 'escape' } });
    snapshot.last.stateVersion = 99;
    expect(session.snapshot().last.stateVersion).toBe(2);
  });
});
