import { describe, expect, it } from 'vitest';
import { locateState, selectStateMatch } from '../../src/runtime/state-locator.js';
const descriptor = (name, options = {}) => ({
    name,
    flowId: 'task-panel',
    filePath: `/tmp/${name}.png`,
    queue: 0,
    threshold: 0.9,
    clickPoint: { x: 0.5, y: 0.5 },
    centerClick: false,
    delayMs: 0,
    loop: false,
    wait: false,
    defaultCandidate: false,
    ...options,
});
const template = (name, options = {}) => ({
    descriptor: descriptor(name, options),
    buffer: Buffer.from(name),
});
const matched = (score) => ({
    score,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    matched: true,
    method: 'template',
});
const state = (id, markers, matchTemplates = []) => ({
    id,
    directory: `/tmp/${id}`,
    markers,
    matchTemplates,
});
describe('state locator', () => {
    it('requires every direct marker image to match', async () => {
        const calls = [];
        const states = [
            state('task-panel', [template('title'), template('tab')]),
            state('home', [template('home')]),
        ];
        const result = await locateState(Buffer.from('frame'), states, {
            method: 'template',
            matcher: {
                matchAll: async (_frame, templates) => {
                    calls.push(templates.map((item) => item.descriptor.name));
                    if (templates[0]?.descriptor.name === 'title')
                        return [matched(0.95), { ...matched(0.95), matched: false, rect: null }];
                    return [matched(0.96)];
                },
            },
        });
        expect(result.state?.id).toBe('home');
        expect(calls).toEqual([['title', 'tab'], ['home']]);
    });
    it('selects a match only from the confirmed state', () => {
        const current = state('task-panel', [template('title')], [
            template('daily-row', { matchId: 'daily-task', gotoFlow: 'execute-daily', doneState: 'daily-complete' }),
        ]);
        const selected = selectStateMatch(current, [matched(0.94)], new Set());
        expect(selected?.descriptor.matchId).toBe('daily-task');
        expect(selected?.descriptor.gotoFlow).toBe('execute-daily');
    });
});
