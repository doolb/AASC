import { HttpRouter } from './http-router.js';

const authorizeFor = (auth) => {
  if (!auth) return async () => true;
  if (typeof auth === 'function') return auth;
  if (typeof auth.authenticate === 'function') return (request) => auth.authenticate(request);
  throw new Error('auth must be a function or provide authenticate(request)');
};

const result = (body, status = 200) => ({ status, body });

/** HTTP facade over the normal package, NavMesh, runtime, and command APIs. */
export const createNavigationHttpService = (options = {}) => {
  const packageService = options.packageService;
  const runtime = options.runtime;
  const router = new HttpRouter({ authorize: authorizeFor(options.auth) });

  router.post('/api/v1/packages/:id/operations', async (_request, params, body) => result(await packageService.apply(params.id, body)));
  router.post('/api/v1/packages/:id/validate', async (_request, params, body) => result(await packageService.validate(params.id, body.revision ?? body)));
  router.post('/api/v1/packages/:id/publish', async (_request, params, body) => result(await packageService.publish(params.id, body.revision ?? body)));

  router.post('/api/v1/navmesh/:id/observations', async (_request, params, body) => {
    if (options.navmeshService?.addObservation) return result(await options.navmeshService.addObservation(params.id, body));
    if (options.navMeshBuilder && options.navMeshStore) return result(await options.navMeshBuilder.buildAndStore(options.navMeshStore, params.id, body));
    throw Object.assign(new Error('NavMesh observation service is not configured'), { statusCode: 503 });
  });
  router.post('/api/v1/navmesh/:id/rebuild', async (_request, params, body) => {
    if (options.navmeshService?.rebuild) return result(await options.navmeshService.rebuild(params.id, body));
    if (options.navMeshBuilder && options.navMeshStore) return result(await options.navMeshBuilder.buildAndStore(options.navMeshStore, params.id, body));
    throw Object.assign(new Error('NavMesh rebuild service is not configured'), { statusCode: 503 });
  });

  router.get('/api/v1/runtime/state', async () => result(runtime?.status?.() ?? runtime?.snapshot?.() ?? runtime?.worldStateStore?.current?.() ?? {}));
  router.get('/api/v1/runtime/goal', async () => {
    if (runtime?.activeGoal?.get) return result(runtime.activeGoal.get());
    throw Object.assign(new Error('active goal controller is not configured'), { statusCode: 503 });
  });
  router.put('/api/v1/runtime/goal', async (_request, _params, body) => {
    if (runtime?.activeGoal?.set) return result(runtime.activeGoal.set(body.goalId, { ...body, source: body.source ?? 'http' }));
    throw Object.assign(new Error('active goal controller is not configured'), { statusCode: 503 });
  });
  router.delete('/api/v1/runtime/goal', async () => {
    if (runtime?.activeGoal?.clear) return result(runtime.activeGoal.clear());
    throw Object.assign(new Error('active goal controller is not configured'), { statusCode: 503 });
  });
  router.get('/api/v1/runtime/goals', async () => {
    if (!runtime?.goalManager?.list || !runtime.goalManager.status) {
      throw Object.assign(new Error('goal manager is not configured'), { statusCode: 503 });
    }
    const goals = runtime.goalManager.list();
    const worldState = runtime.worldStateStore?.current?.() ?? {};
    return result({ activeGoal: runtime.activeGoal?.get?.(), goals: await runtime.goalManager.status(worldState, goals) });
  });
  router.get('/api/v1/runtime/goals/:id', async (_request, params) => {
    if (!runtime?.goalManager?.get || !runtime.goalManager.status) {
      throw Object.assign(new Error('goal manager is not configured'), { statusCode: 503 });
    }
    const goal = await runtime.goalManager.get(params.id);
    if (!goal) throw Object.assign(new Error('goal not found: ' + params.id), { statusCode: 404 });
    const worldState = runtime.worldStateStore?.current?.() ?? {};
    return result((await runtime.goalManager.status(worldState, [goal]))[0]);
  });
  router.post('/api/v1/runtime/goals/:id/progress', async (_request, params, body) => {
    if (!runtime?.goalManager?.get || !runtime.goalManager.record) {
      throw Object.assign(new Error('goal manager is not configured'), { statusCode: 503 });
    }
    const goal = await runtime.goalManager.get(params.id);
    if (!goal) throw Object.assign(new Error('goal not found: ' + params.id), { statusCode: 404 });
    return result(await runtime.goalManager.record(goal, body.patch ?? body, body.at));
  });
  router.post('/api/v1/runtime/goals/:id/pause', async (_request, params, body) => {
    if (!runtime?.activeGoal?.pause) throw Object.assign(new Error('active goal controller is not configured'), { statusCode: 503 });
    const active = runtime.activeGoal.get?.();
    if (active?.goalId && active.goalId !== params.id) throw Object.assign(new Error('goal is not active: ' + params.id), { statusCode: 409 });
    return result(runtime.activeGoal.pause(body.reason ?? 'paused'));
  });
  router.post('/api/v1/runtime/goals/:id/resume', async (_request, params) => {
    if (!runtime?.activeGoal?.resume) throw Object.assign(new Error('active goal controller is not configured'), { statusCode: 503 });
    const active = runtime.activeGoal.get?.();
    if (active?.goalId && active.goalId !== params.id) throw Object.assign(new Error('goal is not active: ' + params.id), { statusCode: 409 });
    return result(runtime.activeGoal.resume());
  });
  router.post('/api/v1/runtime/observations', async (_request, _params, body) => {
    if (runtime?.acceptObservation) return result(await runtime.acceptObservation(body));
    if (runtime?.ingestObservation) return result(await runtime.ingestObservation(body));
    throw Object.assign(new Error('runtime observation endpoint is not configured'), { statusCode: 503 });
  });
  router.post('/api/v1/runtime/simulate', async (_request, _params, body) => {
    if (runtime?.simulate) return result(await runtime.simulate(body));
    if (runtime?.battleSimulator?.simulate) return result(await runtime.battleSimulator.simulate(body));
    throw Object.assign(new Error('runtime simulation endpoint is not configured'), { statusCode: 503 });
  });
  router.get('/api/v1/runtime/alerts', async () => result(runtime?.getAlerts?.() ?? runtime?.alerts ?? runtime?.alertEngine?.active?.() ?? []));
  router.get('/api/v1/runtime/gaps', async () => {
    if (runtime?.gapQueue?.snapshot) return result(runtime.gapQueue.snapshot());
    throw Object.assign(new Error('navigation gap queue is not configured'), { statusCode: 503 });
  });
  router.get('/api/v1/runtime/chain', async (_request, _params, body) => result(runtime?.getChain ? await runtime.getChain(body) : (runtime?.chain ?? null)));
  router.post('/api/v1/runtime/command', async (_request, _params, body) => {
    const enabled = options.execution?.enabled === true || runtime?.config?.execution?.enabled === true;
    if (!enabled && body.execute !== false) return result({ executed: false, reason: 'execution-disabled' });
    if (body.execute === false && runtime?.getCommand) return result(await runtime.getCommand(body));
    if (runtime?.command) return result(await runtime.command(body));
    if (runtime?.getCommand && runtime?.commandExecutor?.execute) {
      const preview = await runtime.getCommand(body);
      if (!preview.executable) return result(preview);
      return result(await runtime.commandExecutor.execute(preview.command, { worldState: runtime.worldStateStore?.current?.() ?? {} }));
    }
    if (runtime?.commandExecutor?.execute) return result(await runtime.commandExecutor.execute(body, { worldState: runtime.worldStateStore?.current?.() ?? {} }));
    return result({ executed: false, reason: 'command-executor-not-configured' }, 503);
  });

  return { handler: (request, response) => router.handle(request, response), router, close: async () => {} };
};
