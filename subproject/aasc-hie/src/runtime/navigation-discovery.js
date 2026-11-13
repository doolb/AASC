const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};

const transientKeys = new Set(['observedAt', 'gameTime', 'receivedAt']);
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !transientKeys.has(key))
    .map(([key, item]) => [key, stableValue(item)]));
  return value;
};
const signatureFor = (observation) => JSON.stringify(canonical(stableValue(observation ?? {})));
const idFor = (prefix, signature) => {
  let hash = 2_166_136_261;
  for (const character of signature) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  return `${prefix}-${hash.toString(36)}`;
};
const stateIdFor = (observation) => observation?.stateId
  ?? observation?.ui?.stateId
  ?? observation?.ui?.topmost
  ?? (Array.isArray(observation?.ui) ? observation.ui.at(-1)?.id : undefined);

/** Turn stable observations into ordinary candidate package mutations. */
export class NavigationDiscovery {
  constructor(options = {}) {
    this.dedupWindowMs = Math.max(0, Number(options.dedupWindowMs ?? 1_000));
    this.lastSignature = undefined;
    this.lastAt = undefined;
    this.previousSignature = undefined;
    this.previousStateId = undefined;
  }

  accept(observation = {}, actionResult, context = {}) {
    const signature = signatureFor(observation);
    const at = Number(context.now ?? observation.observedAt ?? Date.now());
    const duplicate = signature === this.lastSignature && this.lastAt !== undefined && at - this.lastAt <= this.dedupWindowMs;
    const candidateState = { ...clone(observation), candidate: true, signature, stable: !duplicate };
    if (duplicate) return { operations: [], candidateState, confidence: Number(observation.confidence ?? context.worldState?.confidence ?? 0) };

    const stateId = idFor('discovered-state', signature);
    const operations = [{ op: 'add', path: '/states/-', value: { id: stateId, kind: 'discovered-state', candidate: true, signature, observedAt: observation.observedAt, gameTime: observation.gameTime, ui: clone(observation.ui), values: clone(observation.values) } }];
    if (observation.map) {
      operations.push({ op: 'add', path: '/states/-', value: {
        id: idFor('map-observation', signature), kind: 'map-observation', candidate: true, observedAt: observation.observedAt, gameTime: observation.gameTime,
        position: clone(observation.map.position), region: observation.map.region ?? observation.map.semanticLabel, landmark: observation.map.landmark,
        motionSample: clone(observation.map.motionSample ?? observation.motionSample),
      } });
    }
    if (this.previousSignature && this.previousSignature !== signature && actionResult) {
      const observedStateId = stateIdFor(observation);
      const expectedStateId = actionResult.expectedStateId ?? actionResult.nextStateId;
      const verification = expectedStateId || observedStateId ? {
        expectedStateId,
        observedStateId,
      } : undefined;
      operations.push({ op: 'add', path: '/flows/-', value: {
        id: idFor('discovered-transition', `${this.previousSignature}:${signature}:${JSON.stringify(actionResult)}`), kind: 'discovered-transition', candidate: true,
        fromSignature: this.previousSignature, toSignature: signature, action: actionResult.action, actionResult: clone(actionResult), observedAt: observation.observedAt,
        ...(this.previousStateId || observedStateId ? { fromStateId: this.previousStateId, toStateId: observedStateId } : {}),
        ...(verification ? { verified: expectedStateId ? expectedStateId === observedStateId : actionResult.executed === true, verification } : {}),
      } });
    }
    this.previousStateId = stateIdFor(observation);
    this.previousSignature = signature;
    this.lastSignature = signature;
    this.lastAt = at;
    return { operations, candidateState, confidence: Number(observation.confidence ?? context.worldState?.confidence ?? 0) };
  }
}

export { signatureFor };
