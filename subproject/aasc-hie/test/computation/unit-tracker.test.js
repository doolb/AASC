import { describe, expect, it } from 'vitest';
import { UnitTracker } from '../../src/computation/unit-tracker.js';

describe('UnitTracker', () => {
  it('associates timed detections by category/team/position and estimates velocity', () => {
    const tracker = new UnitTracker({ ttlMs: 1_000, associationDistance: 20 });
    const first = tracker.update([], [{ category: 'hero', team: 'enemy', position: { x: 0, y: 4 }, confidence: 0.9 }], 0);
    const second = tracker.update(first, [{ category: 'hero', team: 'enemy', position: { x: 10, y: 4 }, confidence: 0.85 }], 1_000);

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      id: first[0].id,
      category: 'hero',
      team: 'enemy',
      position: { x: 10, y: 4 },
      velocity: { x: 0.01, y: 0 },
      lastSeenAt: 1_000,
      validUntil: 2_000,
      stale: false,
    });
  });

  it('extrapolates a missing unit only through its TTL and then marks it stale', () => {
    const tracker = new UnitTracker({ ttlMs: 1_000 });
    const initial = tracker.update([], [{ id: 'enemy-1', category: 'hero', team: 'enemy', position: { x: 0, y: 0 }, observedAt: 0 }], 0);
    const extrapolated = tracker.update(initial, [], 500);
    expect(extrapolated[0]).toMatchObject({ position: { x: 0, y: 0 }, stale: false, visible: false });

    const moving = tracker.update(initial, [{ id: 'enemy-1', category: 'hero', team: 'enemy', position: { x: 10, y: 0 }, observedAt: 1_000 }], 1_000);
    const extrapolatedMoving = tracker.update(moving, [], 1_500);
    expect(extrapolatedMoving[0]).toMatchObject({ position: { x: 15, y: 0 }, stale: false });

    const stale = tracker.update(moving, [], 2_001);
    expect(stale[0]).toMatchObject({ id: 'enemy-1', stale: true, visible: false });
    expect(stale[0].validUntil).toBe(2_000);
    expect(tracker.active(stale)).toEqual([]);
  });

  it('supports two-dimensional x/z positions for 2.5D units', () => {
    const tracker = new UnitTracker({ ttlMs: 1_000 });
    const first = tracker.update([], [{ category: 'minion', team: 'ally', position: { x: 2, z: 3 } }], 0);
    const second = tracker.update(first, [{ category: 'minion', team: 'ally', position: { x: 4, z: 3 } }], 1_000);

    expect(second[0]).toMatchObject({ position: { x: 4, z: 3 }, velocity: { x: 0.002, z: 0 } });
  });

  it('marks a late detection stale when it has already exceeded its TTL', () => {
    const tracker = new UnitTracker({ ttlMs: 1_000 });
    const result = tracker.update(
      [],
      [{ id: 'late-unit', category: 'hero', team: 'enemy', position: { x: 1, y: 1 }, observedAt: 0 }],
      2_001,
    );

    expect(result[0]).toMatchObject({
      id: 'late-unit',
      stale: true,
      visible: false,
      freshness: { ageMs: 2_001, remainingMs: 0, stale: true },
    });
    expect(tracker.active(result, 2_001)).toEqual([]);
  });
});
