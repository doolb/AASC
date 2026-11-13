import { NavigationRuntime } from './navigation-runtime.js';
import { RuntimeSession } from './runtime-session.js';
import { normalizeEnvironment } from './environment.js';

const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const COMPUTATION_FIELDS = [
  'clock',
  'clockModel',
  'worldStateStore',
  'discovery',
  'discoveryOptions',
  'alertEngine',
  'battleSimulator',
  'simulationGoal',
  'priorityScheduler',
  'planProvider',
  'eventLog',
  'eventLogOptions',
];

const assertRoleId = (value) => {
  if (typeof value !== 'string' || !value.trim() || !ID_PATTERN.test(value.trim())
    || value.trim() === '.' || value.trim() === '..') {
    throw new Error('invalid role id: ' + String(value));
  }
  return value.trim();
};

export const normalizeRole = (role = {}) => {
  if (!role || typeof role !== 'object' || Array.isArray(role)) throw new Error('role must be an object');
  const id = assertRoleId(role.id);
  if (!role.recognition?.observe) throw new Error('role.recognition.observe is required');
  if (role.computation !== undefined
    && (!role.computation || typeof role.computation !== 'object' || Array.isArray(role.computation))) {
    throw new Error('role.computation must be an object');
  }
  return { ...role, id, computation: role.computation ?? {} };
};

const computationOptionsFor = (computation) => Object.fromEntries(
  COMPUTATION_FIELDS
    .filter((field) => computation[field] !== undefined)
    .map((field) => [field, computation[field]]),
);

const executionFor = (role, environment, runtimeOptions) => {
  if (typeof role.execution === 'function') return role.execution(environment);
  return role.execution ?? environment.commandExecutor ?? runtimeOptions.commandExecutor;
};

/**
 * Bind one recognition/computation/execution role to exactly one environment.
 * The underlying NavigationRuntime remains reusable and owns the state machine.
 */
export class RoleRuntime {
  constructor(options = {}) {
    const role = normalizeRole(options.role);
    const environment = normalizeEnvironment(options.environment);
    const runtimeOptions = options.runtimeOptions ?? {};
    const execution = executionFor(role, environment, runtimeOptions);
    if (execution !== undefined && typeof execution.execute !== 'function') {
      throw new Error('role execution must provide execute(command, context)');
    }

    this.id = options.id ?? role.id + '@' + environment.id;
    this.role = role;
    this.environment = environment;
    this.recognition = role.recognition;
    this.computation = role.computation;
    this.execution = execution;

    const packageId = role.packageId ?? options.packageId ?? runtimeOptions.packageId;
    const boundExecution = execution
      ? {
        execute: (command, context = {}) => execution.execute(command, {
          ...context,
          roleId: role.id,
          environmentId: environment.id,
        }),
      }
      : undefined;
    const session = options.session ?? new RuntimeSession({
      id: options.sessionId ?? this.id,
      packageId,
    });

    this.runtime = options.runtimeInstance ?? new NavigationRuntime({
      ...(role.runtimeOptions ?? {}),
      ...runtimeOptions,
      ...computationOptionsFor(role.computation),
      frameSource: environment.frameSource,
      recognizer: role.recognition,
      commandExecutor: boundExecution,
      packageId,
      packageRevision: role.packageRevision ?? options.packageRevision,
      recognitionContext: role.recognitionContext
        ?? environment.recognitionContext
        ?? options.recognitionContext,
      session,
      monotonicNow: options.monotonicNow ?? environment.monotonicNow,
    });
  }

  capabilities() {
    return {
      recognition: typeof this.recognition?.observe === 'function',
      computation: true,
      execution: typeof this.execution?.execute === 'function',
    };
  }

  status() {
    return {
      ...this.runtime.status(),
      roleId: this.role.id,
      environmentId: this.environment.id,
      roleRuntimeId: this.id,
      capabilities: this.capabilities(),
    };
  }

  start() { return this.runtime.start(); }
  stop(reason = 'stopped') { return this.runtime.stop(reason); }
  tickOnce() { return this.runtime.tickOnce(); }
  acceptObservation(observation) { return this.runtime.acceptObservation(observation); }
  ingestObservation(observation) { return this.runtime.ingestObservation(observation); }
}
