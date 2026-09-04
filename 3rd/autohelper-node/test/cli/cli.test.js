import { describe, expect, it } from 'vitest';
import { parseCli } from '../../src/cli.js';
describe('CLI parser', () => {
    it('parses start options and enables dry-run', () => {
        const options = parseCli([
            'start',
            '--device', 'd',
            '--game', 'infinity-nikki',
            '--target', 'daily-routine',
            '--dry-run',
            '--once',
        ]);
        expect(options).toMatchObject({
            command: 'start',
            device: 'd',
            game: 'infinity-nikki',
            target: 'daily-routine',
            dryRun: true,
            once: true,
        });
    });
    it('parses capture regions and numeric runtime options', () => {
        const options = parseCli([
            'capture',
            '--device', 'd',
            '--game', 'infinity-nikki',
            '--feature', 'enter-game',
            '--flow', 'launch',
            '--name', 'button@0.9',
            '--region', '1,2,30,40',
        ]);
        expect(options).toMatchObject({
            command: 'capture',
            region: { x: 1, y: 2, width: 30, height: 40 },
        });
    });
    it('allows capture to write directly to a provider flow root', () => {
        const options = parseCli([
            'capture',
            '--device', 'd',
            '--flow-root', 'flows/netease-cloud/flow',
            '--flow', 'bootstrap',
            '--name', 'new-button@0.9',
        ]);
        expect(options).toMatchObject({
            command: 'capture',
            flowRoot: '/mnt/AASC/3rd/autohelper-node/flows/netease-cloud/flow',
            flow: 'bootstrap',
        });
    });
    it('requires device, game and target for start', () => {
        expect(() => parseCli(['start'])).toThrow('start requires --device, --game and --target');
    });
    it('parses OCR connection options for start', () => {
        const options = parseCli([
            'start',
            '--device', 'd',
            '--game', 'infinity-nikki',
            '--target', 'daily-routine',
            '--ocr-url', 'http://127.0.0.1:8081',
            '--ocr-short-side', '720',
        ]);
        expect(options).toMatchObject({
            command: 'start',
            ocrUrl: 'http://127.0.0.1:8081',
            ocrShortSide: 720,
        });
        expect(options).not.toHaveProperty('ocrDisplay');
    });
    it('does not expose a display selector for OCR', () => {
        expect(() => parseCli([
            'start',
            '--device', 'd',
            '--game', 'infinity-nikki',
            '--target', 'daily-routine',
            '--ocr-display', '2',
        ])).toThrow('Unknown option');
    });
    it('parses navigation package check and chain commands without an ADB device', () => {
        expect(parseCli(['nav-check', '--file', 'navigation/game.nav.md'])).toMatchObject({
            command: 'nav-check',
            file: '/mnt/AASC/3rd/autohelper-node/navigation/game.nav.md',
        });
        expect(parseCli([
            'nav-chain',
            '--file', 'navigation/game.nav.md',
            '--goal-id', 'reach',
            '--state', '{"map":{"safe":true}}',
        ])).toMatchObject({
            command: 'nav-chain',
            goalId: 'reach',
            state: { map: { safe: true } },
        });
    });
});
