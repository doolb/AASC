import { describe, expect, it } from 'vitest';
import { parseTargetDefinition } from '../../src/flow/target-parser.js';
describe('parseTargetDefinition', () => {
    it('parses a text target definition', () => {
        const target = parseTargetDefinition('/tmp/daily-routine.txt', `
      id=daily-routine
      type=daily
      enabled=true
      feature=enter-game
      entry-flow=open-task
      result-state=task-panel
      done-state=daily-complete
      completion=all-discovered-subgoals
    `);
        expect(target).toMatchObject({
            id: 'daily-routine',
            type: 'daily',
            enabled: true,
            feature: 'enter-game',
            entryFlow: 'open-task',
            resultState: 'task-panel',
            doneState: 'daily-complete',
            completion: 'all-discovered-subgoals',
        });
    });
    it('parses an optional NetEase Cloud bootstrap entry', () => {
        const target = parseTargetDefinition('/tmp/daily-inspiration.txt', `
      id=daily-inspiration
      type=daily
      enabled=true
      feature=daily
      entry-flow=open-calendar
      bootstrap-feature=netease-cloud
      bootstrap-flow=bootstrap
      bootstrap-done-state=game-running
      done-state=daily-inspiration
      completion=state
    `);
        expect(target).toMatchObject({
            bootstrapFeature: 'netease-cloud',
            bootstrapFlow: 'bootstrap',
            bootstrapDoneState: 'game-running',
        });
    });
    it('parses a provider-root bootstrap and explicit launch activity', () => {
        const target = parseTargetDefinition('/tmp/daily-inspiration.txt', `
      id=daily-inspiration
      type=daily
      enabled=true
      feature=daily
      entry-flow=open-calendar
      bootstrap-root=netease-cloud
      bootstrap-flow=bootstrap
      bootstrap-done-state=game-running
      bootstrap-package=com.netease.android.cloudgame
      bootstrap-activity=.activity.SplashActivity
      bootstrap-display=0
      done-state=daily-inspiration
      completion=state
    `);
        expect(target).toMatchObject({
            bootstrapRoot: 'netease-cloud',
            bootstrapPackage: 'com.netease.android.cloudgame',
            bootstrapActivity: '.activity.SplashActivity',
            bootstrapDisplay: 0,
        });
    });
    it('requires the target fields and a version period key', () => {
        expect(() => parseTargetDefinition('/tmp/bad.txt', 'id=bad\ntype=daily'))
            .toThrow('missing target field');
        expect(() => parseTargetDefinition('/tmp/version.txt', [
            'id=version-task',
            'type=version',
            'enabled=true',
            'feature=enter-game',
            'entry-flow=open',
            'completion=state',
        ].join('\n'))).toThrow('period-key');
        expect(() => parseTargetDefinition('/tmp/state.txt', [
            'id=state-task',
            'type=daily',
            'enabled=true',
            'feature=enter-game',
            'entry-flow=open',
            'completion=state',
        ].join('\n'))).toThrow('done-state');
    });
});
