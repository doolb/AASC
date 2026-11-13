import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createNavigationHttpService } from '../../src/server/navigation-http-service.js';

const open = async (handler) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

describe('navigation HTTP service', () => {
  it('forwards normal package mutations with author, source, and base revision', async () => {
    const calls = [];
    const service = createNavigationHttpService({
      packageService: { apply: async (id, body) => { calls.push({ id, body }); return { packageId: id, revision: 3 }; } },
      auth: { authenticate: async () => true },
    });
    const { server, url } = await open(service.handler);
    try {
      const response = await fetch(`${url}/api/v1/packages/demo/operations`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ author: { kind: 'external-client', name: 'test' }, source: { url: 'https://example.test/rules', version: '1' }, baseRevision: 2, operations: [{ op: 'add', path: '/rules/hero', value: { movementSpeed: 300 } }] }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ revision: 3 });
      expect(calls[0]).toMatchObject({ id: 'demo', body: { baseRevision: 2, author: { kind: 'external-client' } } });
    } finally { await close(server); }
  });

  it('exposes validation/publication and runtime read endpoints through injectable auth', async () => {
    const service = createNavigationHttpService({
      packageService: {
        validate: async (id, revision) => [{ severity: 'warning', code: 'test', id, revision }],
        publish: async (id, revision) => ({ packageId: id, revision, published: true }),
      },
      runtime: { status: () => ({ running: false, stateVersion: 7, gameTime: 900 }) },
      auth: { authenticate: async () => true },
    });
    const { server, url } = await open(service.handler);
    try {
      const validation = await fetch(`${url}/api/v1/packages/demo/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: 2 }) });
      expect(await validation.json()).toEqual([{ severity: 'warning', code: 'test', id: 'demo', revision: 2 }]);
      const publication = await fetch(`${url}/api/v1/packages/demo/publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: 2 }) });
      expect(await publication.json()).toMatchObject({ published: true, revision: 2 });
      const state = await fetch(`${url}/api/v1/runtime/state`);
      expect(await state.json()).toMatchObject({ stateVersion: 7, gameTime: 900 });
    } finally { await close(server); }
  });

  it('rejects unauthenticated requests and keeps command execution disabled by default', async () => {
    let executed = false;
    const service = createNavigationHttpService({
      runtime: { command: async () => { executed = true; } },
      auth: { authenticate: async () => false },
    });
    const { server, url } = await open(service.handler);
    try {
      const response = await fetch(`${url}/api/v1/runtime/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'tap', point: { x: 1, y: 2 } }) });
      expect(response.status).toBe(401);
      expect(executed).toBe(false);
    } finally { await close(server); }
  });

  it('returns a disabled command result without invoking the runtime command handler by default', async () => {
    let executed = false;
    const service = createNavigationHttpService({
      runtime: { command: async () => { executed = true; return { executed: true }; } },
      auth: { authenticate: async () => true },
    });
    const { server, url } = await open(service.handler);
    try {
      const response = await fetch(`${url}/api/v1/runtime/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'tap', point: { x: 1, y: 2 } }) });
      expect(await response.json()).toEqual({ executed: false, reason: 'execution-disabled' });
      expect(executed).toBe(false);
    } finally { await close(server); }
  });

  it('sets, reads, and clears the externally selected runtime goal', async () => {
    let active;
    const service = createNavigationHttpService({
      runtime: {
        activeGoal: {
          set: (goalId, options) => { active = { goalId, ...options }; return active; },
          get: () => active,
          clear: () => { const previous = active; active = undefined; return previous; },
        },
      },
      auth: { authenticate: async () => true },
    });
    const { server, url } = await open(service.handler);
    try {
      const set = await fetch(`${url}/api/v1/runtime/goal`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goalId: 'daily-inspiration', source: 'manual', priority: 800 }) });
      expect(await set.json()).toMatchObject({ goalId: 'daily-inspiration', priority: 800 });
      const get = await fetch(`${url}/api/v1/runtime/goal`);
      expect(await get.json()).toMatchObject({ goalId: 'daily-inspiration' });
      const clear = await fetch(`${url}/api/v1/runtime/goal`, { method: 'DELETE' });
      expect(await clear.json()).toMatchObject({ goalId: 'daily-inspiration' });
    } finally { await close(server); }
  });

  it('lists goal progress, reads one goal, records progress, and pauses/resumes it', async () => {
    const calls = [];
    const goal = { id: 'daily-inspiration', period: 'daily' };
    let paused = false;
    const service = createNavigationHttpService({
      runtime: {
        activeGoal: {
          get: () => ({ goalId: goal.id, paused }),
          pause: () => { paused = true; return { goalId: goal.id, paused }; },
          resume: () => { paused = false; return { goalId: goal.id, paused }; },
        },
        goalManager: {
          list: () => [goal],
          get: (id) => id === goal.id ? goal : undefined,
          status: async (_worldState, goals) => goals.map((item) => ({ id: item.id, progress: { count: 2, completed: false } })),
          record: async (...args) => { calls.push(args); return { goalId: goal.id, count: 3, completed: true }; },
        },
      },
      auth: { authenticate: async () => true },
    });
    const { server, url } = await open(service.handler);
    try {
      const list = await fetch(`${url}/api/v1/runtime/goals`);
      expect(await list.json()).toMatchObject({ activeGoal: { goalId: goal.id }, goals: [{ id: goal.id }] });
      const one = await fetch(`${url}/api/v1/runtime/goals/${goal.id}`);
      expect(await one.json()).toMatchObject({ id: goal.id, progress: { count: 2 } });
      const progress = await fetch(`${url}/api/v1/runtime/goals/${goal.id}/progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch: { count: 3, completed: true } }) });
      expect(await progress.json()).toMatchObject({ completed: true });
      expect(calls[0][0]).toEqual(goal);
      const pause = await fetch(`${url}/api/v1/runtime/goals/${goal.id}/pause`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(await pause.json()).toMatchObject({ paused: true });
      const resume = await fetch(`${url}/api/v1/runtime/goals/${goal.id}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(await resume.json()).toMatchObject({ paused: false });
    } finally { await close(server); }
  });

  it('returns a chain and a non-executing command preview when execution is disabled', async () => {
    const service = createNavigationHttpService({
      runtime: {
        getChain: async () => ({ goalId: 'daily', status: 'complete' }),
        getCommand: async () => ({ executable: true, command: { action: 'tap', point: { x: 1, y: 2 } } }),
      },
      auth: { authenticate: async () => true },
    });
    const { server, url } = await open(service.handler);
    try {
      const chain = await fetch(`${url}/api/v1/runtime/chain`);
      expect(await chain.json()).toMatchObject({ goalId: 'daily' });
      const preview = await fetch(`${url}/api/v1/runtime/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execute: false }) });
      expect(await preview.json()).toMatchObject({ executable: true, command: { action: 'tap' } });
    } finally { await close(server); }
  });

  it('exposes pending navigation gaps from the runtime queue', async () => {
    const service = createNavigationHttpService({
      runtime: { gapQueue: { snapshot: () => ({ pending: 1, entries: [{ id: 'gap-1', status: 'pending' }] }) } },
      auth: { authenticate: async () => true },
    });
    const { server, url } = await open(service.handler);
    try {
      const response = await fetch(`${url}/api/v1/runtime/gaps`);
      expect(await response.json()).toMatchObject({ pending: 1, entries: [{ id: 'gap-1' }] });
    } finally { await close(server); }
  });

  it('returns 503 when goal management is not configured', async () => {
    const service = createNavigationHttpService({ runtime: {}, auth: { authenticate: async () => true } });
    const { server, url } = await open(service.handler);
    try {
      const response = await fetch(`${url}/api/v1/runtime/goals`);
      expect(response.status).toBe(503);
    } finally { await close(server); }
  });
});
