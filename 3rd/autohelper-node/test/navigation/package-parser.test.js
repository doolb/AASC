import { describe, expect, it } from 'vitest';
import { parseNavigationPackage } from '../../src/navigation/package-parser.js';
const fence = String.fromCharCode(96).repeat(3);
const image = Buffer.from('image').toString('base64');
describe('parseNavigationPackage', () => {
    it('parses multiple scenarios, UI arrays, goals, flows, navmesh references and base64 images', () => {
        const markdown = [
            '# Navigation Package',
            '',
            '## Scenario: daily',
            '',
            fence + 'navigation-json',
            JSON.stringify({
                metadata: { id: 'infinity-nikki', version: '2026.09' },
                scenarios: [{ id: 'daily', priority: 20 }],
                goals: [{
                        id: 'daily-star-sea',
                        kind: 'ui',
                        scenarioId: 'daily',
                        flowId: 'open-daily',
                        success: 'daily.completed == true',
                    }],
                states: [{
                        id: 'daily-page',
                        scenarioId: 'daily',
                        uis: ['world', 'calendar', 'daily'],
                        topmost: 'daily',
                    }],
                flows: [{
                        id: 'open-daily',
                        scenarioId: 'daily',
                        navigator: 'ui',
                        steps: [{ id: 'tap-daily', kind: 'action', action: 'daily-button', goto: 'verify-daily' }],
                    }],
                navmeshes: [{ id: 'world', file: 'world.navmesh' }],
            }),
            fence,
            '',
            '## Scenario: combat',
            '',
            fence + 'navigation-json',
            JSON.stringify({
                scenarios: [{ id: 'combat', priority: 100 }],
                goals: [{ id: 'escape', kind: 'combat', scenarioId: 'combat', delegate: 'spatial-3d' }],
                flows: [{ id: 'escape-flow', scenarioId: 'combat', navigator: 'combat', steps: [] }],
            }),
            fence,
            '',
            '![daily-button](data:image/png;base64,' + image + ')',
        ].join('\n');
        const result = parseNavigationPackage(markdown, '/tmp/infinity-nikki.nav.md');
        expect(result.metadata).toMatchObject({ id: 'infinity-nikki', version: '2026.09' });
        expect(result.scenarios.map((scenario) => scenario.id)).toEqual(['daily', 'combat']);
        expect(result.states[0]).toMatchObject({
            uis: ['world', 'calendar', 'daily'],
            topmost: 'daily',
        });
        expect(result.flows[0].steps[0]).toMatchObject({ goto: 'verify-daily' });
        expect(result.navmeshes).toEqual([{ id: 'world', file: 'world.navmesh', scenarioId: 'daily' }]);
        expect(result.assets[0]).toMatchObject({
            id: 'daily-button',
            mimeType: 'image/png',
            dataBase64: image,
        });
    });
    it('rejects invalid package data with the source path', () => {
        expect(() => parseNavigationPackage(fence + 'navigation-json\n{"metadata":{"version":"1"}}\n' + fence, '/tmp/broken.nav.md')).toThrow('/tmp/broken.nav.md: package metadata.id is required');
        expect(() => parseNavigationPackage([
            fence + 'navigation-json',
            JSON.stringify({
                metadata: { id: 'broken' },
                goals: [{ id: 'same' }, { id: 'same' }],
            }),
            fence,
        ].join('\n'), '/tmp/duplicate.nav.md')).toThrow('/tmp/duplicate.nav.md: duplicate goal id: same');
        expect(() => parseNavigationPackage([
            '# Navigation Package',
            '',
            '![bad](data:image/png;base64,not base64!)',
            '',
            fence + 'navigation-json',
            JSON.stringify({ metadata: { id: 'broken' } }),
            fence,
        ].join('\n'), '/tmp/image.nav.md')).toThrow('/tmp/image.nav.md: invalid base64 image asset');
    });
});
