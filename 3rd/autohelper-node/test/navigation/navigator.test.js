import { describe, expect, it } from 'vitest';
import { Navigator } from '../../src/navigation/navigator.js';
class TestNavigator extends Navigator {
    constructor(id) {
        super(id, 'ui');
    }
    async getCurrentState(_frame) {
        return {
            navigatorId: this.id,
            mode: this.mode,
            status: 'unknown',
            confidence: 0,
            observedAt: '2026-09-04T00:00:00.000Z',
            data: {},
        };
    }
    async generateInstruction(_frame, _target) {
        return {
            mode: 'none',
            confidence: 0,
            reason: 'unknown-state',
        };
    }
}
describe('Navigator', () => {
    it('requires a non-empty navigator id', () => {
        expect(() => new TestNavigator('')).toThrow('navigator id is required');
    });
    it('exposes the navigator id and mode', () => {
        const navigator = new TestNavigator('test');
        expect(navigator.id).toBe('test');
        expect(navigator.mode).toBe('ui');
    });
});
