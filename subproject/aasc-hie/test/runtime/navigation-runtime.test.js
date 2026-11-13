import { describe, expect, it } from 'vitest';
import { NavigationRuntime } from '../../src/runtime/navigation-runtime.js';
import { BattleScoringLayer } from '../../src/computation/battle-scoring-layer.js';

const frame = (observedAt, value) => ({ buffer: Buffer.from([value]), observedAt, source: 'replay' });

describe('NavigationRuntime', () => {
  it('runs configured autonomy layers before command selection and exposes navigation gaps', async () => {
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({ observedAt: 100, ui: [{ id: 'unknown', matched: true }] }) },
      autonomy: {
        instinct: { rules: [] },
        muscleMemory: { failureLimit: 1, planner: () => undefined },
        intelligence: { planner: ({ gaps }) => ({ updates: [{ op: 'add', path: '/flows/-', value: { id: 'generated' } }], plans: [{ id: 'intelligence:repair', priority: 10, plan: { action: 'none' } }], seenGaps: gaps }) },
      },
      recognitionIntervalMs: 0,
    });

    const result = await runtime.tickOnce();

    expect(result.autonomy.gaps).toMatchObject([{ type: 'navigation-gap', requiresIntelligence: true }]);
    expect(result.selected.selectedId).toBe('intelligence:repair');
    expect(result.autonomy.updates).toMatchObject([{ op: 'add', path: '/flows/-' }]);
  });

  it('records autonomy gaps in the runtime repair queue', async () => {
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({ observedAt: 100 }) },
      autonomy: { muscleMemory: { failureLimit: 1, planner: () => undefined } },
      recognitionIntervalMs: 0,
    });

    const result = await runtime.tickOnce();

    expect(result.gapQueue).toMatchObject({ pending: 1, entries: [{ type: 'navigation-gap' }] });
  });

  it('applies intelligence updates through the package service only when explicitly enabled', async () => {
    const applied = [];
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({ observedAt: 100 }) },
      packageId: 'demo',
      packageRevision: 3,
      packageService: {
        apply: async (id, request) => {
          applied.push({ id, request });
          return { revision: 4 };
        },
      },
      applyAutonomyUpdates: true,
      autonomy: {
        intelligence: { planner: () => ({ updates: [{ op: 'add', path: '/flows/-', value: { id: 'generated' } }] }) },
      },
      recognitionIntervalMs: 0,
    });

    const result = await runtime.tickOnce();

    const intelligenceRequest = applied.find((entry) => entry.request.author?.kind === 'intelligence');
    expect(intelligenceRequest).toMatchObject({
      id: 'demo',
      request: { baseRevision: 4, operations: [{ op: 'add', path: '/flows/-' }] },
    });
    expect(result.autonomyRevision).toMatchObject({ revision: 4 });
  });

  it('rejects intelligence updates before package write when package validation fails', async () => {
    const applied = [];
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({ observedAt: 100 }) },
      packageId: 'demo',
      packageRevision: 3,
      packageService: {
        validateOperations: async () => [{ severity: 'error', code: 'missing-reference', message: 'flow is missing' }],
        apply: async (_id, request) => { applied.push(request); return { revision: 4 }; },
      },
      applyAutonomyUpdates: true,
      autonomy: {
        intelligence: { planner: () => ({ updates: [{ op: 'add', path: '/flows/-', value: { id: 'bad' } }] }) },
      },
      recognitionIntervalMs: 0,
    });

    const result = await runtime.tickOnce();

    expect(applied.filter((request) => request.author?.kind === 'intelligence')).toEqual([]);
    expect(result.autonomyRevision).toBeUndefined();
    expect(result.autonomyUpdate).toMatchObject({ applied: false, reason: 'validation-failed', diagnostics: [{ code: 'missing-reference' }] });
    expect(runtime.eventLog.snapshot()).toContainEqual(expect.objectContaining({ type: 'autonomy-update-rejected', code: 'missing-reference' }));
  });

  it('uses the externally selected goal to generate a plan through GoalManager', async () => {
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({ observedAt: 100 }) },
      activeGoal: {
        get: () => ({ goalId: 'daily-inspiration', priority: 800, source: 'manual' }),
      },
      goalManager: {
        get: (goalId) => ({ id: goalId, kind: 'ui' }),
        plan: (_worldState, goal) => ({ id: goal.id, status: 'ready', plan: { action: 'tap', point: { x: 10, y: 20 } } }),
      },
      recognitionIntervalMs: 0,
    });

    const result = await runtime.tickOnce();

    expect(result.activeGoal).toMatchObject({ goalId: 'daily-inspiration', source: 'manual' });
    expect(result.selected.selectedId).toBe('daily-inspiration');
    expect(result.command).toMatchObject({ action: 'tap', point: { x: 10, y: 20 } });
  });

  it('records an active goal completion when automatic lifecycle is enabled', async () => {
    const recorded = [];
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({ observedAt: 100, values: { ready: true } }) },
      activeGoal: { get: () => ({ goalId: 'daily', source: 'manual' }), set() {}, clear() {} },
      goalManager: {
        get: () => ({ id: 'daily', kind: 'ui', success: 'values.ready == true' }),
        plan: () => undefined,
        evaluate: async () => ({ status: 'complete', completed: true }),
        record: async (...args) => { recorded.push(args); },
      },
      autoClearCompletedGoal: true,
      recognitionIntervalMs: 0,
    });

    const result = await runtime.tickOnce();

    expect(recorded[0][0]).toMatchObject({ id: 'daily' });
    expect(recorded[0][1]).toEqual({ completed: true });
    expect(result.goalEvaluation).toMatchObject({ completed: true });
  });

  it('returns the active goal navigation chain and validates a command preview without execution', async () => {
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({ observedAt: 100 }) },
      activeGoal: { get: () => ({ goalId: 'daily', source: 'manual' }) },
      goalManager: {
        get: () => ({ id: 'daily', kind: 'ui', steps: [{ id: 'open', kind: 'action' }] }),
        plan: () => ({ status: 'ready', plan: { action: 'tap', point: { x: 4, y: 5 }, confidence: 1 } }),
      },
      recognitionIntervalMs: 0,
    });

    const chain = await runtime.getChain();
    const preview = await runtime.getCommand();

    expect(chain).toMatchObject({ goalId: 'daily', status: 'complete', currentStepId: 'daily:open' });
    expect(preview).toMatchObject({ executable: true, command: { action: 'tap', point: { x: 4, y: 5 } } });
  });

  it('pauses the active goal after a manual handoff command', async () => {
    let paused;
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({ observedAt: 100 }) },
      activeGoal: {
        get: () => ({ goalId: 'login', source: 'manual' }),
        pause: (reason) => { paused = reason; return { goalId: 'login', paused: true }; },
      },
      planProvider: () => [{ id: 'login', priority: 800, plan: { action: 'manual', reason: 'login-required' } }],
      commandExecutor: { execute: async () => ({ executed: false, reason: 'manual-handoff', paused: true }) },
      execution: { enabled: true },
      recognitionIntervalMs: 0,
    });

    const result = await runtime.tickOnce();

    expect(paused).toBe('manual-handoff');
    expect(result.commandResult).toMatchObject({ reason: 'manual-handoff', paused: true });
  });

  it('suppresses ordinary actions while the active goal is paused for manual handoff', async () => {
    let calls = 0;
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({ observedAt: 100, ui: [{ id: 'login' }] }) },
      activeGoal: { get: () => ({ goalId: 'login', paused: true, pauseReason: 'manual-handoff' }) },
      planProvider: () => [{ id: 'tap', priority: 900, sourceLayer: 'muscle-memory', plan: { action: 'tap', point: { x: 1, y: 1 } } }],
      commandExecutor: { execute: async () => { calls += 1; return { executed: true }; } },
      execution: { enabled: true }, recognitionIntervalMs: 0,
    });
    const result = await runtime.tickOnce();
    expect(result.command).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('records command failures and requests review after the configured limit', async () => {
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({ observedAt: 100 }) },
      planProvider: () => [{ id: 'tap', priority: 1, plan: { action: 'tap', point: { x: 1, y: 1 } } }],
      commandExecutor: { execute: async () => { throw new Error('device lost'); } },
      execution: { enabled: true },
      commandFailureLimit: 2,
      recognitionIntervalMs: 0,
    });

    const first = await runtime.tickOnce();
    const second = await runtime.tickOnce();

    expect(first.commandResult).toMatchObject({ executed: false, reason: 'execution-error' });
    expect(second.executionReview).toMatchObject({ consecutive: 2, requiresReview: true });
  });

  it('records selected layer execution and verifies its expected state on the next frame', async () => {
    let now = 100;
    const scorer = new BattleScoringLayer({ now: () => now });
    const runtime = new NavigationRuntime({
      monotonicNow: () => now,
      frameSource: { next: async () => frame(now, 1) },
      recognizer: { observe: async () => ({ observedAt: now, ui: [{ id: now === 100 ? 'menu' : 'battle-hud' }], confidence: 1 }) },
      planProvider: () => [{ id: 'enter', priority: 1, sourceLayer: 'muscle-memory',
        plan: { action: 'tap', point: { x: 1, y: 1 }, expectedStateId: 'battle-hud' } }],
      commandExecutor: { execute: async () => ({ executed: true, reason: 'executed' }) },
      battleScorer: scorer,
      execution: { enabled: true },
      recognitionIntervalMs: 0,
    });
    await runtime.tickOnce();
    now = 200;
    const second = await runtime.tickOnce();
    expect(second.battleScore).toMatchObject({
      commandCount: 2, verifiedTransitionCount: 1,
      layers: { 'muscle-memory': { commandCount: 2, executedCount: 2 } },
    });
  });

  it('does not overlap recognition ticks when a frame takes longer than the interval', async () => {
    let release;
    let observations = 0;
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: () => new Promise((resolve) => { release = () => resolve(frame(100, 1)); }) },
      recognizer: { observe: async () => { observations += 1; return { observedAt: 100 }; } },
      recognitionIntervalMs: 0,
    });
    const first = runtime.tickOnce();
    const second = await runtime.tickOnce();
    expect(second).toMatchObject({ skipped: true, reason: 'tick-in-flight' });
    release();
    await first;
    expect(observations).toBe(1);
  });

  it('does not execute an in-flight timer command after stop', async () => {
    let release;
    let calls = 0;
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: () => new Promise((resolve) => { release = () => resolve(frame(100, 1)); }) },
      recognizer: { observe: async () => ({ observedAt: 100, confidence: 1 }) },
      planProvider: () => [{ id: 'tap', priority: 1, plan: { action: 'tap', point: { x: 1, y: 1 } } }],
      commandExecutor: { execute: async () => { calls += 1; return { executed: true }; } },
      execution: { enabled: true }, recognitionIntervalMs: 1000,
    });
    runtime.start();
    const pending = runtime.tickOnce();
    runtime.stop();
    release();
    expect((await pending).commandResult).toMatchObject({ executed: false, reason: 'runtime-stopped' });
    expect(calls).toBe(0);
  });

  it('feeds localization feedback into world state and emits a stop plan when localization is lost', async () => {
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({ observedAt: 100 }) },
      localizer: { update: async () => ({ available: false, method: 'lost', confidence: 0, requiresStop: true }) },
      recognitionIntervalMs: 0,
    });

    const result = await runtime.tickOnce();

    expect(result.localization).toMatchObject({ method: 'lost', requiresStop: true });
    expect(result.selected.selected).toMatchObject({ action: 'stop', reason: 'localization-lost' });
  });

  it('runs a deterministic observation-to-state-to-discovery tick and advances state versions', async () => {
    let now = 100;
    let frames = [frame(100, 1), frame(200, 2)];
    const applied = [];
    const runtime = new NavigationRuntime({
      monotonicNow: () => now,
      frameSource: { next: async () => frames.shift() },
      recognizer: { observe: async (input) => ({ observedAt: input.observedAt, values: { screen: input.buffer[0] }, map: { position: { x: input.buffer[0], z: 0 }, region: 'road' } }) },
      packageId: 'demo',
      packageService: { apply: async (id, request) => { applied.push({ id, request }); return { revision: applied.length }; } },
      execution: { enabled: false },
      planProvider: () => [{ id: 'stop', priority: 1, plan: { action: 'stop', confidence: 1 } }],
      recognitionIntervalMs: 0,
    });

    const first = await runtime.tickOnce();
    now = 200;
    const second = await runtime.tickOnce();

    expect(first.worldState.stateVersion).toBe(1);
    expect(second.worldState.stateVersion).toBe(2);
    expect(applied.every((entry) => entry.id === 'demo')).toBe(true);
    expect(second.commandResult).toMatchObject({ executed: false, reason: 'execution-disabled' });
  });

  it('honors sensor interval and exposes five consecutive abnormal observations', async () => {
    let now = 0;
    let calls = 0;
    const runtime = new NavigationRuntime({
      monotonicNow: () => now,
      frameSource: { next: async () => frame(now, ++calls) },
      recognizer: { observe: async (input) => ({ observedAt: input.observedAt, abnormal: true }) },
      recognitionIntervalMs: 100,
    });

    const first = await runtime.tickOnce();
    now = 50;
    const skipped = await runtime.tickOnce();
    now = 100;
    const results = [first];
    for (let index = 0; index < 4; index += 1) { results.push(await runtime.tickOnce()); now += 100; }

    expect(skipped.skipped).toBe(true);
    expect(calls).toBe(5);
    expect(results.at(-1).abnormal).toMatchObject({ consecutive: 5, requiresReview: true });
  });

  it('accepts an already normalized observation for the HTTP runtime endpoint', async () => {
    const runtime = new NavigationRuntime({
      monotonicNow: () => 100,
      frameSource: { next: async () => frame(100, 1) },
      recognizer: { observe: async () => ({}) },
    });

    const result = await runtime.acceptObservation({ observedAt: 100, values: { ready: true } });

    expect(result.worldState).toMatchObject({ stateVersion: 1, values: { ready: { value: true } } });
  });
});
