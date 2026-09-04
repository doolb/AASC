import { describe, expect, it } from 'vitest';
import { Spatial3dNavigator } from '../../src/navigation/spatial3d-navigator.js';
describe('Spatial3dNavigator', () => {
    it('records visible interactables and recommends a jump for a close obstacle', async () => {
        const navigator = new Spatial3dNavigator({
            perception: {
                analyze: async () => ({
                    region: 'jumpable',
                    confidence: 0.93,
                    distance: 0.35,
                    interactables: [{
                            id: 'stone-1',
                            kind: 'obstacle',
                            confidence: 0.91,
                            distance: 0.35,
                        }],
                }),
            },
            now: () => '2026-09-03T00:00:00.000Z',
        });
        await expect(navigator.getCurrentState(Buffer.from('frame'))).resolves.toMatchObject({
            mode: 'spatial-3d',
            id: 'jumpable',
            status: 'confirmed',
            data: { region: 'jumpable' },
        });
        await expect(navigator.generateInstruction(Buffer.from('frame'), {
            id: 'reach-lake',
            kind: 'spatial-3d',
        })).resolves.toMatchObject({
            mode: 'spatial-3d',
            action: 'jump',
            reason: 'close-jumpable-obstacle',
        });
        expect(navigator.getMapSnapshot()).toMatchObject({
            interactables: [{ id: 'stone-1', kind: 'obstacle' }],
        });
    });
    it('does not move when the spatial region is unknown', async () => {
        const navigator = new Spatial3dNavigator({
            perception: {
                analyze: async () => ({
                    region: 'unknown',
                    confidence: 0.2,
                    interactables: [],
                }),
            },
        });
        await expect(navigator.generateInstruction(Buffer.from('frame'), {
            id: 'reach-lake',
            kind: 'spatial-3d',
        })).resolves.toMatchObject({
            mode: 'none',
        });
    });
});
