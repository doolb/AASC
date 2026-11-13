import { describe, expect, it } from 'vitest';
import { EnvironmentRegistry } from '../../src/runtime/environment.js';
import { RoleHost } from '../../src/runtime/role-host.js';
import { RoleRuntime } from '../../src/runtime/role-runtime.js';

const frame = (value) => ({ buffer: Buffer.from([value]), observedAt: value, source: 'role-test' });

const roleFor = (id, executions) => ({
  id,
  packageId: id + '-package',
  recognition: {
    observe: async (input) => ({
      observedAt: input.observedAt,
      values: { role: id, frame: input.buffer[0] },
    }),
  },
  computation: {
    planProvider: () => [{
      id: id + '-plan',
      priority: 10,
      plan: { action: 'observe-' + id },
    }],
  },
  execution: {
    execute: async (command, context) => {
      executions.push({ command, roleId: context.roleId, environmentId: context.environmentId });
      return { executed: true, roleId: context.roleId, environmentId: context.environmentId };
    },
  },
});

describe('RoleHost', () => {
  it('runs isolated roles concurrently in different environments', async () => {
    const executions = [];
    const host = new RoleHost({
      environments: [
        { id: 'adb-phone-a', frameSource: { next: async () => frame(1) } },
        { id: 'cloud-browser-b', frameSource: { next: async () => frame(2) } },
      ],
    });
    const hok = host.registerRole(roleFor('honor-of-kings', executions), 'adb-phone-a', {
      runtimeOptions: { recognitionIntervalMs: 0, execution: { enabled: true } },
    });
    const nikki = host.registerRole(roleFor('infinity-nikki', executions), 'cloud-browser-b', {
      runtimeOptions: { recognitionIntervalMs: 0, execution: { enabled: true } },
    });

    const results = await host.tickAll();

    expect(results).toHaveLength(2);
    expect(results.map((entry) => entry.environmentId)).toEqual(['adb-phone-a', 'cloud-browser-b']);
    expect(results.map((entry) => entry.result.worldState.stateVersion)).toEqual([1, 1]);
    expect(results[0].result.worldState.values.role.value).toBe('honor-of-kings');
    expect(results[1].result.worldState.values.role.value).toBe('infinity-nikki');
    expect(executions).toEqual(expect.arrayContaining([
      expect.objectContaining({ roleId: 'honor-of-kings', environmentId: 'adb-phone-a' }),
      expect.objectContaining({ roleId: 'infinity-nikki', environmentId: 'cloud-browser-b' }),
    ]));
    expect(hok.runtime).not.toBe(nikki.runtime);
    expect(hok.status().capabilities).toEqual({ recognition: true, computation: true, execution: true });
    expect(nikki.status().capabilities).toEqual({ recognition: true, computation: true, execution: true });
  });

  it('keeps one role per environment by default and supports explicit shared environments', () => {
    const environment = { id: 'shared-device', frameSource: { next: async () => frame(3) } };
    const host = new RoleHost({ environments: [environment] });
    host.registerRole(roleFor('first', []), 'shared-device');
    expect(() => host.registerRole(roleFor('second', []), 'shared-device')).toThrow(/already assigned/);

    const sharedHost = new RoleHost({ environments: [environment], allowSharedEnvironment: true });
    sharedHost.registerRole(roleFor('first', []), 'shared-device');
    expect(() => sharedHost.registerRole(roleFor('second', []), 'shared-device')).not.toThrow();
  });

  it('registers environments independently from role runtimes', () => {
    const registry = new EnvironmentRegistry();
    registry.register({ id: 'env-1', frameSource: { next: async () => frame(1) } });
    expect(registry.list().map((environment) => environment.id)).toEqual(['env-1']);
    expect(() => registry.get('missing')).toThrow(/not registered/);
    expect(() => new RoleRuntime({
      role: roleFor('missing-frame-source', []),
      environment: { id: 'invalid' },
    })).toThrow(/frameSource/);
  });
});
