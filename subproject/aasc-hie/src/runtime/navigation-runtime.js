import { ClockModel } from '../computation/clock-model.js';
import { WorldStateStore } from '../computation/world-state.js';
import { AlertEngine } from '../computation/alert-engine.js';
import { PriorityScheduler } from '../computation/priority-scheduler.js';
import { NavigationDiscovery } from './navigation-discovery.js';
import { RuntimeSession } from './runtime-session.js';
import { EventLog } from './event-log.js';
import { normalizeRuntimeConfig } from './runtime-config.js';
import { AutonomyCoordinator } from '../computation/autonomy-layers.js';
import { ActiveGoalController } from './active-goal.js';
import { buildNavigationChain } from '../computation/navigation/navigation-chain.js';
import { CommandValidator } from '../execution/command.js';
import { NavigationGapQueue } from './navigation-gap-queue.js';

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const nowNumber = (value) => {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  return Date.now();
};

/** Coordinate recognition, state, planning, alerts, and optional execution on a timer. */
export class NavigationRuntime {
  constructor(options = {}) {
    this.config = normalizeRuntimeConfig(options);
    this.frameSource = options.frameSource;
    this.recognizer = options.recognizer;
    if (!this.frameSource?.next || !this.recognizer?.observe) throw new Error('frameSource.next and recognizer.observe are required');
    this.clockModel = options.clockModel ?? new ClockModel(options.clock ?? {});
    this.worldStateStore = options.worldStateStore ?? new WorldStateStore(options);
    this.discovery = options.discovery ?? new NavigationDiscovery(options.discoveryOptions);
    this.packageService = options.packageService;
    this.packageId = options.packageId;
    this.packageRevision = options.packageRevision ?? 0;
    this.applyAutonomyUpdates = options.applyAutonomyUpdates === true;
    this.autonomyUpdateValidator = options.autonomyUpdateValidator;
    this.recognitionContext = options.recognitionContext ?? {};
    this.alertEngine = options.alertEngine;
    this.battleSimulator = options.battleSimulator;
    this.battleScorer = options.battleScorer;
    this.simulationGoal = options.simulationGoal;
    this.priorityScheduler = options.priorityScheduler ?? new PriorityScheduler(options);
    this.autonomyCoordinator = options.autonomyCoordinator
      ?? (options.autonomy ? new AutonomyCoordinator(options.autonomy) : undefined);
    this.gapQueue = options.gapQueue ?? new NavigationGapQueue(options.gapQueueOptions);
    this.activeGoal = options.activeGoal ?? new ActiveGoalController(options.activeGoalOptions);
    this.goalManager = options.goalManager;
    this.localizer = options.localizer;
    this.localizerMap = options.localizerMap;
    this.localizationStopConfidence = Number(options.localizationStopConfidence ?? 0);
    this.autoAdvanceGoals = options.autoAdvanceGoals === true;
    this.autoClearCompletedGoal = options.autoClearCompletedGoal === true;
    this.planProvider = options.planProvider;
    this.commandExecutor = options.commandExecutor;
    this.eventLog = options.eventLog ?? new EventLog(options.eventLogOptions);
    this.session = options.session ?? new RuntimeSession({ packageId: this.packageId });
    this.monotonicNow = options.monotonicNow ?? (() => Date.now());
    this.lastRecognitionAt = undefined;
    this.lastObservation = undefined;
    this.lastCommandResult = undefined;
    this.pendingVerification = undefined;
    this.commandFailureConsecutive = 0;
    this.abnormalConsecutive = 0;
    this.timer = undefined;
    this.running = false;
    this.tickInFlight = false;
    this.runGeneration = 0;
  }

  status() { return { running: this.running, session: this.session.snapshot(), stateVersion: this.worldStateStore.current().stateVersion }; }

  start() {
    if (this.running) return this.status();
    this.runGeneration += 1;
    this.running = true;
    this.session.start(this.monotonicNow());
    const interval = Math.max(1, this.config.recognitionIntervalMs);
    this.timer = setInterval(() => { this.tickOnce().catch((error) => this.eventLog.append({ type: 'runtime-error', message: error.message })); }, interval);
    this.timer.unref?.();
    return this.status();
  }

  stop(reason = 'stopped') {
    this.runGeneration += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.running = false;
    this.session.stop(reason, this.monotonicNow());
    return this.status();
  }

  async resolveGoal(options = {}) {
    if (options.goal) return options.goal;
    const active = this.activeGoal?.get?.();
    const goalId = options.goalId ?? active?.goalId;
    if (!goalId || !this.goalManager?.get) throw new Error('goal manager and goalId are required');
    const goal = await this.goalManager.get(goalId);
    if (!goal) throw new Error('goal not found: ' + goalId);
    return goal;
  }

  async getChain(options = {}) {
    const worldState = options.worldState ?? this.worldStateStore.current();
    const goal = await this.resolveGoal(options);
    const planResult = options.plan ?? (this.goalManager?.plan ? await this.goalManager.plan(worldState, goal) : undefined);
    const plan = planResult?.plan ?? planResult;
    const chain = buildNavigationChain(worldState, goal, {
      plan,
      planStatus: planResult?.status,
      reason: planResult?.reason,
      navigator: options.navigator,
      selectedStepIds: options.selectedStepIds,
      branches: options.branches,
    });
    return {
      ...chain,
      currentStepId: chain.selected.nodeIds[0],
      executable: chain.status !== 'blocked' && chain.selected.nodeIds.length > 0,
    };
  }

  async getCommand(options = {}) {
    const goal = await this.resolveGoal(options);
    const worldState = options.worldState ?? this.worldStateStore.current();
    const planResult = options.plan ?? (this.goalManager?.plan ? await this.goalManager.plan(worldState, goal) : undefined);
    const plan = planResult?.plan ?? planResult;
    const command = options.command
      ?? (plan?.command ?? plan?.instruction)
      ?? (typeof plan?.action === 'object' ? plan.action : (plan?.action ? plan : undefined));
    const chain = await this.getChain({ ...options, goal, plan: planResult });
    if (!command || typeof command !== 'object') return { executable: false, reason: planResult?.reason ?? 'command-not-generated', chain };
    const validator = this.commandExecutor?.validator ?? new CommandValidator(options.validatorOptions);
    const validation = validator.validate(command, worldState);
    return { executable: validation.valid && chain.executable !== false, command: clone(command), validation, chain };
  }

  verifyPendingCommand(observation, worldState) {
    if (!this.pendingVerification || !Array.isArray(observation.ui)
      || worldState.observedAt <= this.pendingVerification.observedAt) return undefined;
    const verification = this.battleScorer?.recordVerification?.({
      expectedStateId: this.pendingVerification.expectedStateId,
      observedStateId: worldState.ui.topmost,
      verified: worldState.ui.topmost === this.pendingVerification.expectedStateId,
    });
    this.pendingVerification = undefined;
    return verification;
  }

  async acceptObservation(observation = {}) {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) throw new Error('normalized observation must be an object');
    const now = nowNumber(observation.observedAt ?? this.monotonicNow());
    const clockHint = observation.clock ?? observation.clockHint ?? observation.gameTimeHint ?? observation.gameTime;
    const clockState = this.clockModel.update(clockHint, now);
    const applied = this.worldStateStore.apply(observation, clockState);
    const commandVerification = this.verifyPendingCommand(observation, applied.worldState);
    const discovery = this.discovery.accept(observation, this.lastCommandResult, { now, worldState: applied.worldState, previousObservation: this.lastObservation });
    let discoveryRevision;
    if (discovery.operations.length && this.packageService?.apply && this.packageId) {
      const revision = await this.packageService.apply(this.packageId, {
        baseRevision: this.packageRevision,
        operations: discovery.operations,
        author: { kind: 'runtime-discovery', name: 'aasc-hie' },
        source: { url: 'https://localhost/aasc-hie/runtime', version: 'runtime' },
      });
      discoveryRevision = revision;
      this.packageRevision = revision.revision ?? revision.data?.revision ?? this.packageRevision;
    }
    const abnormal = observation.abnormal === true || observation.status === 'abnormal';
    this.abnormalConsecutive = abnormal ? this.abnormalConsecutive + 1 : 0;
    const abnormalState = { consecutive: this.abnormalConsecutive, requiresReview: this.abnormalConsecutive >= this.config.abnormalObservationLimit };
    for (const event of [...clockState.events, ...applied.events]) await this.eventLog.append(event);
    this.lastObservation = clone(observation);
    const result = { observation: clone(observation), clockState: clone(clockState), worldState: applied.worldState, discovery, discoveryRevision, commandVerification, battleScore: this.battleScorer?.snapshot?.(), abnormal: abnormalState };
    this.session.record({ stateVersion: applied.worldState.stateVersion, observedAt: applied.worldState.observedAt, abnormal: abnormalState });
    return result;
  }

  ingestObservation(observation) { return this.acceptObservation(observation); }

  async tickOnce() {
    if (this.tickInFlight) return { skipped: true, reason: 'tick-in-flight', stateVersion: this.worldStateStore.current().stateVersion };
    this.tickInFlight = true;
    try { return await this.runTickOnce(); }
    finally { this.tickInFlight = false; }
  }

  async runTickOnce() {
    const startedWhileRunning = this.running;
    const generation = this.runGeneration;
    const now = nowNumber(this.monotonicNow());
    if (this.lastRecognitionAt !== undefined && now - this.lastRecognitionAt < this.config.recognitionIntervalMs) {
      return { skipped: true, reason: 'recognition-interval', stateVersion: this.worldStateStore.current().stateVersion };
    }
    this.lastRecognitionAt = now;
    const frame = await this.frameSource.next();
    const extraContext = typeof this.recognitionContext === 'function'
      ? await this.recognitionContext(this.worldStateStore.current())
      : this.recognitionContext;
    const rawObservation = await this.recognizer.observe(frame, { ...extraContext, now });
    const localization = this.localizer?.update
      ? await this.localizer.update(rawObservation, this.localizerMap ?? this.worldStateStore.current().map?.navmesh ?? {})
      : undefined;
    const observation = localization?.position
      ? { ...rawObservation, map: { ...(rawObservation.map ?? {}), position: clone(localization.position) }, localization }
      : (localization ? { ...rawObservation, localization } : rawObservation);
    const clockHint = observation.clock ?? observation.clockHint ?? observation.gameTimeHint ?? observation.gameTime;
    const clockState = this.clockModel.update(clockHint, nowNumber(observation.observedAt ?? now));
    const applied = this.worldStateStore.apply(observation, clockState);
    const commandVerification = this.verifyPendingCommand(observation, applied.worldState);
    const discovery = this.discovery.accept(observation, this.lastCommandResult, { now, worldState: applied.worldState, previousObservation: this.lastObservation });
    let discoveryRevision;
    if (discovery.operations.length && this.packageService?.apply && this.packageId) {
      const revision = await this.packageService.apply(this.packageId, {
        baseRevision: this.packageRevision,
        operations: discovery.operations,
        author: { kind: 'runtime-discovery', name: 'aasc-hie' },
        source: { url: 'https://localhost/aasc-hie/runtime', version: 'runtime' },
      });
      discoveryRevision = revision;
      this.packageRevision = revision.revision ?? revision.data?.revision ?? this.packageRevision;
    }
    const activeGoal = this.activeGoal?.get?.();
    const configuredGoal = activeGoal?.goalId && this.goalManager?.get
      ? await this.goalManager.get(activeGoal.goalId)
      : undefined;
    const goal = typeof this.simulationGoal === 'function'
      ? await this.simulationGoal(applied.worldState)
      : (this.simulationGoal ?? configuredGoal);
    const goalPlan = goal && this.goalManager?.plan
      ? await this.goalManager.plan(applied.worldState, goal)
      : undefined;
    const goalEvaluation = goal && this.goalManager?.evaluate
      ? await this.goalManager.evaluate(applied.worldState, goal)
      : undefined;
    if (goalEvaluation?.completed && this.goalManager?.record && (this.autoAdvanceGoals || this.autoClearCompletedGoal)) {
      await this.goalManager.record(goal, { completed: true });
      if (this.autoAdvanceGoals && this.goalManager.next && this.activeGoal?.set) {
        const nextGoal = await this.goalManager.next(applied.worldState, goal);
        if (nextGoal) this.activeGoal.set(nextGoal.id, { source: 'auto-advance', priority: activeGoal?.priority });
        else if (this.autoClearCompletedGoal && this.activeGoal.clear) this.activeGoal.clear();
      } else if (this.autoClearCompletedGoal && this.activeGoal?.clear) {
        this.activeGoal.clear();
      }
    }
    const preview = goal && this.battleSimulator ? this.battleSimulator.simulate({ worldState: applied.worldState, goal }) : undefined;
    const alerts = this.alertEngine ? [
      ...this.alertEngine.evaluate(applied.worldState, preview, now),
      ...this.alertEngine.clear(applied.worldState, now, preview),
    ] : [];
    const autonomy = this.autonomyCoordinator
      ? await this.autonomyCoordinator.decide({
        worldState: applied.worldState,
        observation,
        goal,
        preview,
        alerts,
        gaps: this.gapQueue.list(),
        lastCommandResult: this.lastCommandResult,
        now,
      })
      : undefined;
    const newGaps = autonomy?.layers?.flatMap((layer) => layer.gaps ?? []) ?? [];
    for (const gap of newGaps) this.gapQueue.report(gap);
    let autonomyRevision;
    let autonomyUpdate;
    if (this.applyAutonomyUpdates && autonomy?.updates?.length && this.packageService?.apply && this.packageId) {
      const request = {
        baseRevision: this.packageRevision,
        operations: autonomy.updates,
        author: { kind: 'intelligence', name: 'aasc-hie' },
        source: { url: 'https://localhost/aasc-hie/runtime', version: 'autonomy' },
      };
      let diagnostics = [];
      try {
        const validator = this.autonomyUpdateValidator
          ?? this.packageService.validateOperations?.bind(this.packageService);
        if (validator) diagnostics = await validator(this.packageId, request.baseRevision, request.operations, request);
      } catch (error) {
        diagnostics = [{ severity: 'error', code: error.code ?? 'validation-error', message: error.message }];
      }
      const errors = (Array.isArray(diagnostics) ? diagnostics : []).filter((item) => item?.severity === 'error');
      if (errors.length) {
        autonomyUpdate = { applied: false, reason: 'validation-failed', diagnostics: clone(errors) };
        for (const diagnostic of errors) await this.eventLog.append({
          type: 'autonomy-update-rejected',
          code: diagnostic.code,
          message: diagnostic.message,
        });
      } else {
        const revision = await this.packageService.apply(this.packageId, request);
        autonomyRevision = revision;
        autonomyUpdate = { applied: true, revision: clone(revision) };
        this.packageRevision = revision.revision ?? revision.data?.revision ?? this.packageRevision;
      }
    }
    const providerCandidates = typeof this.planProvider === 'function'
      ? await this.planProvider(applied.worldState, preview, alerts, goal)
      : (this.planProvider ?? []);
    const candidates = [
      ...(localization?.requiresStop || Number(localization?.confidence ?? 1) < this.localizationStopConfidence ? [{
        id: 'instinct:localization-stop',
        priority: 1000,
        plan: { action: 'stop', reason: 'localization-lost' },
        sourceLayer: 'instinct',
      }] : []),
      ...(goalPlan?.plan && goalPlan.status !== 'blocked' ? [{
        id: activeGoal?.goalId ?? goal?.id,
        priority: activeGoal?.priority ?? 500,
        plan: goalPlan.plan,
        sourceLayer: 'goal-manager',
      }] : []),
      ...(autonomy?.plans ?? []),
      ...(Array.isArray(providerCandidates) ? providerCandidates : []),
    ].filter((candidate) => activeGoal?.paused !== true || candidate.sourceLayer === 'instinct');
    const selected = Array.isArray(candidates) ? this.priorityScheduler.select(applied.worldState, candidates) : undefined;
    const command = selected?.selected?.command ?? selected?.selected?.instruction
      ?? (selected?.selected?.action ? selected.selected : undefined);
    let commandResult;
    if (command) {
      const issuedAt = Number(this.monotonicNow());
      if (startedWhileRunning && (!this.running || this.runGeneration !== generation)) {
        commandResult = { executed: false, reason: 'runtime-stopped' };
      } else if (this.config.execution.enabled && this.commandExecutor) {
        try {
          commandResult = await this.commandExecutor.execute(command, { worldState: applied.worldState });
        } catch (error) {
          commandResult = { executed: false, reason: 'execution-error', message: error.message };
        }
      } else commandResult = { executed: false, reason: 'execution-disabled' };
      this.battleScorer?.recordCommand?.({
        executed: commandResult?.executed === true,
        reason: commandResult?.reason,
        sourceLayer: selected?.candidate?.sourceLayer,
        issuedAt,
        completedAt: Number(this.monotonicNow()),
      });
      const expectedStateId = command.expectedStateId ?? command.nextStateId ?? commandResult?.expectedStateId;
      if (commandResult?.executed === true && expectedStateId) {
        this.pendingVerification = { expectedStateId, observedAt: applied.worldState.observedAt };
      }
    }
    if (commandResult?.reason === 'manual-handoff' && this.activeGoal?.pause) this.activeGoal.pause('manual-handoff');
    const nonFailureReasons = new Set(['execution-disabled', 'dry-run', 'manual-handoff', 'rate-limited', 'cancelled']);
    const commandFailed = Boolean(commandResult && commandResult.executed !== true && !nonFailureReasons.has(commandResult.reason));
    this.commandFailureConsecutive = commandFailed ? this.commandFailureConsecutive + 1 : 0;
    const executionReview = { consecutive: this.commandFailureConsecutive, requiresReview: this.commandFailureConsecutive >= this.config.commandFailureLimit };
    this.lastCommandResult = commandResult;
    this.lastObservation = clone(observation);
    const abnormal = observation.abnormal === true || observation.status === 'abnormal';
    this.abnormalConsecutive = abnormal ? this.abnormalConsecutive + 1 : 0;
    const abnormalState = { consecutive: this.abnormalConsecutive, requiresReview: this.abnormalConsecutive >= this.config.abnormalObservationLimit };
    const events = [
      ...clockState.events,
      ...applied.events,
      ...alerts.map((alert) => ({ type: `alert-${alert.type === 'clear' ? 'cleared' : 'raised'}`, id: alert.id })),
      ...(autonomy?.gaps ?? []).map((gap) => ({ type: 'navigation-gap', ...gap })),
      ...(commandFailed ? [{ type: 'execution-error', message: commandResult.message, consecutive: this.commandFailureConsecutive }] : []),
    ];
    for (const event of events) await this.eventLog.append(event);
    const result = { skipped: false, frame: clone(frame), observation: clone(observation), localization: clone(localization), clockState: clone(clockState), worldState: applied.worldState, discovery, discoveryRevision, autonomyRevision, autonomyUpdate: clone(autonomyUpdate), activeGoal: clone(activeGoal), goal: clone(goal), goalPlan: clone(goalPlan), goalEvaluation: clone(goalEvaluation), preview, alerts, autonomy: clone(autonomy), gapQueue: this.gapQueue.snapshot(), selected, command: clone(command), commandResult, commandVerification, battleScore: this.battleScorer?.snapshot?.(), executionReview, abnormal: abnormalState };
    this.session.record({ stateVersion: applied.worldState.stateVersion, observedAt: applied.worldState.observedAt, selectedId: selected?.selectedId, abnormal: abnormalState });
    return result;
  }
}
