# AASC-HIE Runtime Loop

The runtime keeps device I/O behind injected adapters and processes each
observation in the same order:

~~~text
frame source
  -> observation-only recognizer
  -> clock calibration and immutable world state
  -> navigation discovery candidates
  -> optional simulation preview
  -> alerts
  -> priority-selected plan and navigation chain
  -> command validation
  -> optional dry-run or device execution
~~~

Inside computation, instinct safety plans are evaluated first, muscle memory
uses configured routines, and intelligence receives navigation gaps and may
return candidate updates. Intelligence never executes input commands.

## Start and verify

From the project root:

~~~sh
npm install
npm test
npm run build
node src/cli.js nav-check --file data/packages/honor-of-kings.nav.md
node src/cli.js nav-chain --file data/packages/honor-of-kings.nav.md --goal-id map-sample-route
~~~

The standalone shell reports missing dependencies for nav-serve until a host
supplies the package service and runtime adapters. In that configured host,
the safe startup command is:

~~~sh
npm run nav-serve -- --host 127.0.0.1 --port 8787 --dry-run
~~~

The host should enable live execution only for an explicitly configured
CommandExecutor; setting execution.enabled alone does not create an ADB
connection.

## Runtime state

Every accepted observation advances stateVersion. State snapshots carry
observedAt, calibrated gameTime, confidence, UI layers, map position,
tracked units, and freshness fields. A unit is extrapolated only until its
configured TTL, then marked stale and excluded from high-confidence decisions.

Discovery returns ordinary package operations. It does not write package files,
invent semantic goal names, or create a privileged large-model path. If a
package service is injected, those operations are submitted through the same
revision and provenance checks used by every other client.

## Dry-run behavior

The integration fixture in
test/integration/fake-device-flow.test.js uses a fake frame source, clock,
recognizer, NavMesh, tracked enemy, and ADB adapter. It proves that an enemy
warning can select a retreat route and return its chain before execution. The
command is validated, then reported as dry-run; the fake device receives no
call.

Manual login and similar account steps use a `manual` command. The executor
returns `manual-handoff` without touching the device and pauses the active goal.
After the operator finishes, resume it through the active-goal HTTP endpoint or
the runtime controller.
