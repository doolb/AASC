import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { UiNavigator } from '../../src/navigation/ui-navigator.js';
const frame = () => {
    const image = new PNG({ width: 100, height: 100 });
    image.data.fill(0);
    for (let index = 3; index < image.data.length; index += 4)
        image.data[index] = 255;
    return PNG.sync.write(image);
};
const descriptor = (name) => ({
    name,
    flowId: 'open-calendar',
    filePath: `/tmp/${name}.png`,
    queue: 0,
    threshold: 0.9,
    clickPoint: { x: 0.5, y: 0.5 },
    centerClick: false,
    delayMs: 0,
    loop: false,
    wait: false,
    defaultCandidate: false,
});
const template = (image) => ({
    descriptor: image,
    buffer: Buffer.from(image.name),
});
const matched = () => ({
    score: 0.95,
    rect: { x: 10, y: 20, width: 40, height: 30 },
    matched: true,
    method: 'template',
});
describe('UiNavigator', () => {
    it('reports the current UI state and generates a tap instruction', async () => {
        const marker = descriptor('world-marker');
        const action = descriptor('calendar-button');
        const state = {
            id: 'world',
            directory: '/tmp/world',
            markers: [template(marker)],
            matchTemplates: [],
        };
        const context = {
            id: 'open-calendar',
            directory: '/tmp/open-calendar',
            descriptors: [action],
            templates: [template(action)],
        };
        const navigator = new UiNavigator({
            states: [state],
            repository: {
                current: () => context,
                switchTo: async () => context,
            },
            matcher: {
                matchAll: async (_image, templates) => (templates.map(() => matched())),
            },
        });
        await expect(navigator.getCurrentState(frame())).resolves.toMatchObject({
            mode: 'ui',
            id: 'world',
            status: 'confirmed',
        });
        await expect(navigator.generateInstruction(frame(), {
            id: 'open-calendar',
            kind: 'ui',
            actionName: 'calendar-button',
        })).resolves.toMatchObject({
            mode: 'ui',
            action: 'tap',
            actionName: 'calendar-button',
            point: { x: 30, y: 35 },
        });
    });
    it('does not generate a tap when no UI state is confirmed', async () => {
        const context = {
            id: 'open-calendar',
            directory: '/tmp/open-calendar',
            descriptors: [],
            templates: [],
        };
        const navigator = new UiNavigator({
            states: [],
            repository: {
                current: () => context,
                switchTo: async () => context,
            },
            matcher: {
                matchAll: async () => [],
            },
        });
        await expect(navigator.generateInstruction(frame(), {
            id: 'open-calendar',
            kind: 'ui',
            actionName: 'calendar-button',
        })).resolves.toMatchObject({
            mode: 'none',
        });
    });
});
