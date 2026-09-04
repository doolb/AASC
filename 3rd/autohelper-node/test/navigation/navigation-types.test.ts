import { describe, expect, it } from 'vitest';
import type { NavigationInstruction } from '../../src/navigation/types.js';

describe('navigation core types', () => {
  it('represents an unknown state as a non-action instruction', () => {
    const instruction: NavigationInstruction = {
      mode: 'none',
      confidence: 0,
      reason: 'unknown-state',
    };

    expect(instruction).toEqual({
      mode: 'none',
      confidence: 0,
      reason: 'unknown-state',
    });
  });
});
