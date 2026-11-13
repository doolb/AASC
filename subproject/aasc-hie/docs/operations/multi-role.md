# Multi-role runtime

A role is one game or application behavior profile composed from three
capabilities:

- recognition turns an environment frame into a normalized observation.
- computation owns world state, planning, simulation, priorities, and alerts.
- execution validates and sends a command through the bound environment.

A role runtime binds one role to one environment. Each binding owns its
NavigationRuntime, RuntimeSession, WorldStateStore, clock, discovery state,
event log, package revision, and command result. Navigation packages and
NavMesh
documents may be shared read-only.

## Example

~~~js
const host = new RoleHost({
  environments: [
    { id: 'adb-phone-a', frameSource: adbFrameSourceA },
    { id: 'cloud-browser-b', frameSource: browserFrameSourceB },
  ],
});

host.registerRole(honorOfKingsRole, 'adb-phone-a', {
  runtimeOptions: { execution: { enabled: false } },
});
host.registerRole(infinityNikkiRole, 'cloud-browser-b', {
  runtimeOptions: { execution: { enabled: false } },
});

await host.tickAll();
~~~

Each role receives roleId and environmentId in its execution context. The host
rejects two roles bound to the same environment by default, because concurrent
commands to one device are unsafe. Set allowSharedEnvironment only when the
environment provides its own multiplexing or locking policy.

Role and environment metadata belongs under data/roles and
data/environments. Adapters remain injected by the host application; secrets
and live device handles should not be committed to data files.
