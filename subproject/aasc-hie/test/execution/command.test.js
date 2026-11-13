import { describe, expect, it } from 'vitest';
import { CommandValidator } from '../../src/execution/command.js';

describe('CommandValidator', () => {
  const worldState = { stateVersion: 3, confidence: 0.9 };

  it('rejects expired, stale-version, low-confidence, and invalid coordinate commands', () => {
    const validator = new CommandValidator({ now: () => 1_000, minConfidence: 0.8, screen: { width: 1_000, height: 500 } });

    expect(validator.validate({ action: 'tap', point: { x: 10, y: 10 }, expiresAt: 999 }, worldState)).toMatchObject({ valid: false, reason: 'expired' });
    expect(validator.validate({ action: 'tap', point: { x: 10, y: 10 }, targetStateVersion: 2 }, worldState)).toMatchObject({ valid: false, reason: 'state-version-mismatch' });
    expect(validator.validate({ action: 'tap', point: { x: 10, y: 10 }, confidence: 0.2 }, worldState)).toMatchObject({ valid: false, reason: 'confidence-too-low' });
    expect(validator.validate({ action: 'tap', point: { x: 1_001, y: 10 } }, worldState)).toMatchObject({ valid: false, reason: 'point-out-of-bounds' });
  });

  it('validates taps, swipes, and bounded joystick vectors', () => {
    const validator = new CommandValidator({ now: () => 1_000, joystickRadius: 100 });

    expect(validator.validate({ action: 'tap', point: { x: 10, y: 20 } }, worldState).valid).toBe(true);
    expect(validator.validate({ action: 'swipe', from: { x: 0, y: 0 }, to: { x: 10, y: 20 }, durationMs: 200 }, worldState).valid).toBe(true);
    expect(validator.validate({ action: 'move', vector: { x: 101, y: 0 } }, worldState)).toMatchObject({ valid: false, reason: 'joystick-radius-exceeded' });
  });
});
