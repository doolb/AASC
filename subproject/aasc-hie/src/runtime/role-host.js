import { EnvironmentRegistry } from './environment.js';
import { RoleRuntime, normalizeRole } from './role-runtime.js';

const environmentFor = (registry, value) => {
  if (typeof value === 'string') return registry.get(value);
  if (!value || typeof value !== 'object') throw new Error('environment or environment id is required');
  return registry.has(value.id) ? registry.get(value.id) : registry.register(value);
};

/** Manage isolated role runtimes and run them concurrently across environments. */
export class RoleHost {
  constructor(options = {}) {
    this.environments = options.environmentRegistry
      ?? new EnvironmentRegistry(options.environments ?? []);
    this.allowSharedEnvironment = options.allowSharedEnvironment === true;
    this.runtimes = new Map();
  }

  registerEnvironment(environment) {
    return this.environments.register(environment);
  }

  registerRole(role, environmentOrId, options = {}) {
    const normalizedRole = normalizeRole(role);
    const environment = environmentFor(this.environments, environmentOrId);
    const id = options.id ?? normalizedRole.id + '@' + environment.id;
    if (this.runtimes.has(id)) throw new Error('role runtime is already registered: ' + id);
    if (!this.allowSharedEnvironment && this.list().some((runtime) => runtime.environment.id === environment.id)) {
      throw new Error('environment is already assigned to another role: ' + environment.id);
    }

    const runtime = new RoleRuntime({
      ...options,
      id,
      role: normalizedRole,
      environment,
    });
    this.runtimes.set(id, runtime);
    return runtime;
  }

  has(id) { return this.runtimes.has(id); }

  get(id) {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error('role runtime is not registered: ' + String(id));
    return runtime;
  }

  list() { return [...this.runtimes.values()]; }

  status() {
    const runtimes = this.list().map((runtime) => runtime.status());
    return { running: runtimes.some((runtime) => runtime.running), runtimes };
  }

  startAll() { return this.list().map((runtime) => runtime.start()); }

  stopAll(reason = 'host-stopped') {
    return this.list().map((runtime) => runtime.stop(reason));
  }

  async tickAll() {
    const results = await Promise.all(this.list().map(async (runtime) => ({
      roleRuntimeId: runtime.id,
      roleId: runtime.role.id,
      environmentId: runtime.environment.id,
      result: await runtime.tickOnce(),
    })));
    return results;
  }

  stop(id, reason = 'stopped') { return this.get(id).stop(reason); }

  unregister(id, reason = 'unregistered') {
    const runtime = this.get(id);
    const status = runtime.stop(reason);
    this.runtimes.delete(id);
    return status;
  }
}
