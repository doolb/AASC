import { describe, expect, it } from 'vitest';
describe('navigation core types', () => {
    it('represents an unknown state as a non-action instruction', () => {
        const instruction = {
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
