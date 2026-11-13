import { Buffer } from 'node:buffer';
import { PACKAGE_ID_PATTERN, isObject } from './package-types.js';

const diagnostic = (severity, code, message, nodeId) => ({
  severity,
  code,
  message,
  ...(nodeId ? { nodeId } : {}),
});

const idSet = (values) => new Set((Array.isArray(values) ? values : []).map((value) => value?.id));
const assetIdFor = (value) => (typeof value === 'string' ? value : value?.assetId);
const safeId = (value) => typeof value === 'string' && PACKAGE_ID_PATTERN.test(value)
  && value !== '.' && value !== '..';
const mapTarget = (value) => (
  typeof value?.kind === 'string' && value.kind.startsWith('map-')
  || typeof value?.spaceModel === 'string'
  || typeof value?.navmeshId === 'string'
);
const validRelativePath = (value) => (
  typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\')
    && !value.split('/').some((part) => part === '' || part === '.' || part === '..')
    && /^[A-Za-z0-9._/-]+$/.test(value)
);
const unsafeExpression = (value) => typeof value === 'string'
  && /(?:\b(?:process|globalThis|global|require|module)\s*\.|\b(?:eval|Function)\s*\(|=>|;)/.test(value);
const validImageDataUri = (value) => {
  if (typeof value !== 'string') return false;
  const match = value.match(/^data:image\/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) return false;
  const data = match[1].replace(/\s/g, '');
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return false;
  const decoded = Buffer.from(data, 'base64');
  return decoded.length > 0 && decoded.toString('base64') === data;
};

const validateIds = (navigationPackage, diagnostics) => {
  for (const [field, code] of [
    ['scenarios', 'invalid-scenario-id'],
    ['goals', 'invalid-goal-id'],
    ['states', 'invalid-state-id'],
    ['flows', 'invalid-flow-id'],
    ['navmeshes', 'invalid-navmesh-id'],
    ['assets', 'invalid-asset-id'],
    ['alerts', 'invalid-alert-id'],
  ]) {
    const seen = new Set();
    for (const value of navigationPackage[field] ?? []) {
      if (!isObject(value) || !safeId(value.id)) diagnostics.push(
        diagnostic('error', code, `${field.slice(0, -1)} id must be a safe package ID`),
      );
      if (value?.id && seen.has(value.id)) diagnostics.push(
        diagnostic('error', `duplicate-${field.slice(0, -1)}`, `${field.slice(0, -1)} IDs must be unique`),
      );
      if (value?.id) seen.add(value.id);
    }
  }
};

const validateGoals = (navigationPackage, diagnostics) => {
  const goals = Array.isArray(navigationPackage.goals) ? navigationPackage.goals : [];
  const goalIds = idSet(goals);
  const flowIds = idSet(navigationPackage.flows);
  const navmeshIds = idSet(navigationPackage.navmeshes);
  const visit = (goal, parentId = 'goal') => {
    if (!isObject(goal)) return;
    const id = goal.id ?? parentId;
    if (goal.flowId && !flowIds.has(goal.flowId)) diagnostics.push(diagnostic(
      'error', 'missing-reference', `goal ${id} references missing flow: ${goal.flowId}`, `goal:${id}`,
    ));
    if (mapTarget(goal)) {
      if (!goal.navmeshId) diagnostics.push(diagnostic(
        'error', 'map-target-missing-navmesh', `map target ${id} requires navmeshId`, `goal:${id}`,
      ));
      else if (!navmeshIds.has(goal.navmeshId)) diagnostics.push(diagnostic(
        'error', 'missing-navmesh', `map target ${id} references missing NavMesh: ${goal.navmeshId}`, `goal:${id}`,
      ));
    }
    if (unsafeExpression(goal.success)) diagnostics.push(diagnostic(
      'error', 'unsafe-expression', `goal ${id} contains an unsafe expression`, `goal:${id}`,
    ));
    for (const child of goal.steps ?? []) visit(child, id);
  };
  for (const goal of goals) visit(goal);
  return goalIds;
};

export const validateNavigationPackage = (navigationPackage) => {
  const diagnostics = [];
  if (!isObject(navigationPackage)) return [diagnostic('error', 'invalid-package', 'package must be an object')];
  const packageId = navigationPackage.metadata?.id;
  if (!safeId(packageId)) diagnostics.push(
    diagnostic('error', 'invalid-package-id', 'package metadata.id must be a safe package ID'),
  );
  validateIds(navigationPackage, diagnostics);
  for (const field of ['revision', 'baseRevision']) {
    if (navigationPackage[field] !== undefined
      && (!Number.isInteger(navigationPackage[field]) || navigationPackage[field] < 0)) diagnostics.push(
        diagnostic('error', 'invalid-revision', `${field} must be a non-negative integer`),
      );
  }

  const navmeshIds = new Set();
  for (const navmesh of navigationPackage.navmeshes ?? []) {
    if (navmesh?.id) navmeshIds.add(navmesh.id);
    if (!validRelativePath(navmesh?.file)) diagnostics.push(
      diagnostic('error', 'invalid-navmesh-file', `NavMesh ${navmesh?.id ?? '(unknown)'} file must be a safe relative path`),
    );
  }

  const goalIds = validateGoals(navigationPackage, diagnostics);
  const assets = new Set((navigationPackage.assets ?? []).map((asset) => asset?.id));
  for (const asset of navigationPackage.assets ?? []) {
    if (!validImageDataUri(asset?.dataUri) || asset?.url !== undefined || asset?.file !== undefined) diagnostics.push(
      diagnostic('error', 'invalid-image', `asset ${asset?.id ?? '(unknown)'} is not a Base64 image data URL`),
    );
  }
  const checkAsset = (owner, reference, label) => {
    const assetId = assetIdFor(reference);
    if (assetId && !assets.has(assetId)) diagnostics.push(
      diagnostic('error', 'missing-asset', `${label} references missing asset: ${assetId}`, owner),
    );
  };
  for (const state of navigationPackage.states ?? []) {
    for (const marker of state.markers ?? []) checkAsset(`state:${state.id}`, marker, `state ${state.id}`);
    for (const match of state.matches ?? []) checkAsset(`state:${state.id}`, match, `state ${state.id}`);
  }
  for (const flow of navigationPackage.flows ?? []) {
    for (const step of flow.steps ?? []) {
      checkAsset(`flow:${flow.id}:${step.id}`, step, `flow ${flow.id} step ${step.id}`);
      for (const candidate of step.candidates ?? []) checkAsset(
        `flow:${flow.id}:${step.id}`, candidate, `flow ${flow.id} step ${step.id} candidate ${candidate.id}`,
      );
    }
  }
  const alertIds = new Set();
  for (const alert of navigationPackage.alerts ?? []) {
    if (!isObject(alert) || typeof alert.id !== 'string' || !PACKAGE_ID_PATTERN.test(alert.id)) diagnostics.push(
      diagnostic('error', 'invalid-alert-id', 'alert id must be a safe package ID'),
    );
    if (alert?.id) alertIds.add(alert.id);
    if (alert?.suggestedGoal && !goalIds.has(alert.suggestedGoal)) diagnostics.push(
      diagnostic('error', 'missing-reference', `alert ${alert.id} references missing goal: ${alert.suggestedGoal}`, `alert:${alert.id}`),
    );
    if (unsafeExpression(alert?.when)) diagnostics.push(
      diagnostic('error', 'unsafe-expression', `alert ${alert?.id ?? '(unknown)'} contains an unsafe expression`, `alert:${alert?.id}`),
    );
  }
  if (navmeshIds.size !== (navigationPackage.navmeshes ?? []).length) diagnostics.push(
    diagnostic('error', 'duplicate-navmesh', 'NavMesh IDs must be unique'),
  );
  if (alertIds.size !== (navigationPackage.alerts ?? []).length) diagnostics.push(
    diagnostic('error', 'duplicate-alert', 'alert IDs must be unique'),
  );
  return diagnostics;
};
