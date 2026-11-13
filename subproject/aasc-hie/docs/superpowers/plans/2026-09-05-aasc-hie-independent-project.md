# AASC-HIE Independent Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent pure-JavaScript AASC-HIE project at `/mnt/aasc-hie`, split into recognition, computation, execution, package, runtime, and server boundaries while preserving the normal navigation-data API for humans, scripts, and large-model clients.

**Architecture:** Recognition produces normalized observations only. Computation owns time-aware world state, unit tracking, simulation, navigation, priorities, and alerts. Execution owns ADB/browser commands. Markdown navigation packages and independent NavMesh files are versioned data, and all clients mutate them through the same validated HTTP/JS API.

**Tech Stack:** Node.js ESM, JavaScript, `@techstark/opencv-js` precompiled runtime, `onnxruntime-web`, `pngjs`, `bmp-js`, Vitest, ADB, and the existing external OCR HTTP boundary.

**Spec:** `docs/superpowers/specs/2026-09-05-aasc-hie-architecture-design.md`

## Global Constraints

- Project root is `/mnt/aasc-hie`; the old `/mnt/AASC/3rd/autohelper-node` tree is read-only input and must not be modified.
- Runtime source is pure JavaScript ESM and must not contain game-specific coordinates, game names, or game-specific control branches.
- Recognition reports observations and never executes input or selects goals.
- Computation never calls ADB or browser input directly.
- Execution is disabled by default, validates state version and command expiry, and supports dry-run mode.
- OCR is called only when a package-configured state value requires it; normal UI matching uses OpenCV or configured detectors.
- Large-model clients use the normal package/data API and receive no privileged write path.
- All package mutations require `author`, `baseRevision`, validation, and publication before runtime use.
- NavMesh files are independent resources; images in Markdown packages are Base64 data URLs.
- Pure tests must run without a connected device, OCR server, or downloaded model.
- Every task ends with a focused test command and a complete project test before the next task.

---

### Task 1: Create the independent project shell

**Files:**
- Create: `/mnt/aasc-hie/package.json`
- Create: `/mnt/aasc-hie/vitest.config.js`
- Create: `/mnt/aasc-hie/.gitignore`
- Create: `/mnt/aasc-hie/README.md`
- Create: `/mnt/aasc-hie/docs/usage.md`
- Create: `/mnt/aasc-hie/test/project-shell.test.js`
- Create: `/mnt/aasc-hie/docs/superpowers/specs/2026-09-05-aasc-hie-architecture-design.md`
- Create: `/mnt/aasc-hie/docs/superpowers/plans/2026-09-05-aasc-hie-independent-project.md`

**Interfaces:**
- Produces package scripts `build`, `test`, `test:watch`, `start`, `nav-check`, `nav-chain`, `nav-serve`, and `nav-map-build`.
- Produces the directory contract `src/recognition`, `src/computation`, `src/execution`, `src/package`, `src/runtime`, `src/server`, `packages`, `navmesh`, `models`, `data`, and `test`.

- [ ] **Step 1: Write the failing shell test**

```js
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AASC-HIE project shell', () => {
  it('declares the layer directories and ESM package', () => {
    const root = resolve(import.meta.dirname, '..');
    expect(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).type).toBe('module');
    for (const directory of ['src/recognition', 'src/computation', 'src/execution', 'src/package', 'src/runtime', 'src/server']) {
      expect(existsSync(resolve(root, directory))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- test/project-shell.test.js`

Expected: FAIL because the new project files and layer directories do not exist.

- [ ] **Step 3: Create the shell**

Create `package.json` with the same pinned runtime dependencies as the reusable project and these scripts:

```json
{
  "type": "module",
  "scripts": {
    "build": "node --check src/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node src/index.js",
    "nav-check": "node src/cli.js nav-check",
    "nav-chain": "node src/cli.js nav-chain",
    "nav-serve": "node src/cli.js nav-serve",
    "nav-map-build": "node src/cli.js nav-map-build"
  }
}
```

Create the layer directories, `src/index.js` with a named `createApplication` export, and `.gitignore` entries for `node_modules`, runtime logs, temporary frames, and unpublished data. Keep the design spec and this plan in the new project. Initialize the new directory as an independent Git repository and commit only the shell and approved design documents.

- [ ] **Step 4: Run the focused test and build**

Run: `npm install && npm test -- test/project-shell.test.js && npm run build`

Expected: the shell test passes and `node --check src/index.js` exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js .gitignore README.md docs src/index.js test/project-shell.test.js
git commit -m "chore: initialize independent aasc-hie project"
```

### Task 2: Define shared contracts and package loading

**Files:**
- Create: `src/package/package-parser.js`
- Create: `src/package/package-repository.js`
- Create: `src/package/package-validator.js`
- Create: `src/package/package-types.js`
- Create: `src/package/navigation-data-service.js`
- Create: `test/package/package-parser.test.js`
- Create: `test/package/package-validator.test.js`
- Create: `test/package/navigation-data-service.test.js`
- Create: `packages/example.nav.md`

**Interfaces:**
- `parseNavigationPackage(markdown, filePath) -> NavigationPackage`
- `NavigationPackageRepository.load(filePath) -> NavigationPackage`
- `NavigationPackageRepository.saveRevision(packageId, baseRevision, operations, metadata) -> PackageRevision`
- `NavigationDataService.apply(packageId, request) -> PackageRevision`
- `NavigationDataService.validate(packageId, revision) -> Diagnostic[]`
- `NavigationDataService.publish(packageId, revision) -> PublishedPackage`

- [ ] **Step 1: Write tests for Markdown parsing and normal mutation**

Test that a `navigation-json` block, Base64 image data URL, navmesh reference, rules, alert, and author/source metadata are parsed. Test that an operation with the wrong `baseRevision` is rejected and that a valid operation creates a new revision without knowing whether its author is human, script, or large model.

- [ ] **Step 2: Run package tests and verify they fail**

Run: `npm test -- test/package`

Expected: FAIL because parser, repository, validator, and service modules are absent.

- [ ] **Step 3: Implement the minimal package contracts**

Preserve the existing navigation package JSON shape where compatible. Store revisions as JSON under `data/packages/<packageId>/revisions/<revision>.json`; only `publish()` may copy a validated revision to the active package location. Accept mutation operations in this form:

```js
{
  author: { kind: 'external-client', name: 'llm' },
  source: { url: 'https://www.honorofkings.com/zh-CN/experience.html', version: '9.x' },
  baseRevision: 2,
  operations: [
    { op: 'add', path: '/rules/hero/movementSpeed', value: 350 }
  ]
}
```

Use a restricted JSON-pointer operation set (`add`, `replace`, `remove`) and reject arbitrary JavaScript expressions or file paths. Validate package IDs, revision integers, Base64 image data URLs, goal references, and NavMesh references.

- [ ] **Step 4: Run package tests**

Run: `npm test -- test/package`

Expected: all parser, validator, revision, and publication tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/package test/package packages/example.nav.md
git commit -m "feat: add validated navigation package contracts"
```

### Task 3: Build the recognition layer

**Files:**
- Create: `src/recognition/frame-source.js`
- Create: `src/recognition/image-decoder.js`
- Create: `src/recognition/opencv-runtime.js`
- Create: `src/recognition/image-matcher.js`
- Create: `src/recognition/ocr-client.js`
- Create: `src/recognition/yolo-detector.js`
- Create: `src/recognition/observation-normalizer.js`
- Create: `src/recognition/index.js`
- Create: `test/recognition/image-decoder.test.js`
- Create: `test/recognition/image-matcher.test.js`
- Create: `test/recognition/ocr-client.test.js`
- Create: `test/recognition/observation-normalizer.test.js`
- Create: `test/recognition/recognition-boundary.test.js`

**Interfaces:**
- `FrameSource.next() -> { buffer, observedAt, source }`
- `Recognizer.observe(frame, context) -> Observation`
- `OpenCvImageMatcher.match(frameBuffer, template, method) -> MatchResult`
- `OcrClient.read(imageBuffer, options) -> OcrResult`
- `YoloDetector.detect(imageBuffer, modelId, options) -> Detection[]`
- `normalizeObservation(input) -> Observation`

- [ ] **Step 1: Write boundary tests**

Test that a recognizer returns observations only, that missing optional sensors produce `unknown` values with confidence 0, that OCR is not called when its trigger is false, and that recognition modules have no executor dependency.

- [ ] **Step 2: Run recognition tests and verify they fail**

Run: `npm test -- test/recognition`

Expected: FAIL because the new recognition modules are absent.

- [ ] **Step 3: Migrate reusable vision code into the new namespace**

Copy the reusable pure-JavaScript implementations from the old project into `src/recognition`, preserving precompiled OpenCV.js, PNG/BMP decoding, local YOLO/ONNX adapters, and external OCR HTTP behavior. Adapt imports and export only recognition contracts. Keep model IDs and coordinate transforms in package configuration. The layer must never import `src/execution`, call ADB input, select goals, or emit alerts.

- [ ] **Step 4: Run recognition tests and build**

Run: `npm test -- test/recognition && npm run build`

Expected: all recognition tests pass without ADB, OCR service, or model files.

- [ ] **Step 5: Commit**

```bash
git add src/recognition test/recognition
git commit -m "feat: add observation-only recognition layer"
```

### Task 4: Implement time-aware computation state

**Files:**
- Create: `src/computation/clock-model.js`
- Create: `src/computation/world-state.js`
- Create: `src/computation/state-fusion.js`
- Create: `src/computation/unit-tracker.js`
- Create: `src/computation/restricted-expression.js`
- Create: `src/computation/index.js`
- Create: `test/computation/clock-model.test.js`
- Create: `test/computation/world-state.test.js`
- Create: `test/computation/state-fusion.test.js`
- Create: `test/computation/unit-tracker.test.js`
- Create: `test/computation/restricted-expression.test.js`

**Interfaces:**
- `ClockModel.update(clockHint, monotonicNow) -> ClockState`
- `WorldStateStore.apply(observation, clockState) -> { stateVersion, worldState, events }`
- `StateFusion.merge(worldState, observation) -> WorldState`
- `UnitTracker.update(units, detections, now) -> TrackedUnit[]`
- `evaluateExpression(expression, context) -> boolean | number | string`

- [ ] **Step 1: Write deterministic time and tracking tests**

Cover game-time calibration, pause/resume, clock drift events, immutable state versions, overlapping UI layers plus `topmost`, velocity estimation from timed positions, short-TTL extrapolation, stale-unit exclusion, and rejection of expressions containing function calls, property escapes, or external access.

- [ ] **Step 2: Run computation tests and verify they fail**

Run: `npm test -- test/computation`

Expected: FAIL because the computation modules are absent.

- [ ] **Step 3: Implement the state model**

Use plain objects with `observedAt`, `gameTime`, `confidence`, `lastSeenAt`, `validUntil`, and `stateVersion`. Preserve every visible UI layer in an array. Associate detections by category/team/position, estimate velocity, extrapolate only until the configured TTL, then mark the entity `stale`. Make `WorldStateStore.apply()` return a new snapshot instead of mutating a snapshot held by a simulator or HTTP caller.

- [ ] **Step 4: Run computation tests**

Run: `npm test -- test/computation`

Expected: all clock, state, tracking, fusion, and expression tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/computation/clock-model.js src/computation/world-state.js src/computation/state-fusion.js src/computation/unit-tracker.js src/computation/restricted-expression.js src/computation/index.js test/computation
git commit -m "feat: add time-aware world state and unit tracking"
```

### Task 5: Migrate navigation and add battle simulation

**Files:**
- Create: `src/computation/navigation/map-navigator.js`
- Create: `src/computation/navigation/ui-navigator.js`
- Create: `src/computation/navigation/moba25d-navigator.js`
- Create: `src/computation/navigation/navmesh-store.js`
- Create: `src/computation/navigation/navmesh-builder.js`
- Create: `src/computation/navigation/pathfinder.js`
- Create: `src/computation/navigation/navigation-chain.js`
- Create: `src/computation/battle-simulator.js`
- Create: `src/computation/goal-planner.js`
- Create: `src/computation/priority-scheduler.js`
- Create: `test/computation/navigation/pathfinder.test.js`
- Create: `test/computation/navigation/navigation-chain.test.js`
- Create: `test/computation/battle-simulator.test.js`
- Create: `test/computation/goal-planner.test.js`
- Create: `test/computation/priority-scheduler.test.js`

**Interfaces:**
- `navigator.getCurrentState(worldState) -> NavigatorState`
- `navigator.plan(worldState, goal) -> Plan`
- `navigator.generateInstruction(worldState, plan) -> Command`
- `navigator.getNavigationChain(worldState, goal) -> NavigationChain`
- `BattleSimulator.simulate({ worldState, goal, horizonMs, stepMs, branches, seed }) -> Preview`
- `GoalPlanner.expand(worldState, goal) -> GoalChain`
- `PriorityScheduler.select(worldState, candidates) -> SelectedPlan`

- [ ] **Step 1: Write navigation and simulation tests**

Test that the existing 2.5D pathfinder returns a complete path through walkable polygons and blocks obstacles; that a navigation chain and simulation preview share `stateVersion` and branch IDs; that the simulator does not mutate its input; that a stale unit lowers prediction confidence; that a retreat goal can delegate movement to the map navigator; and that critical safety plans preempt ordinary movement according to configured priority.

- [ ] **Step 2: Run navigation tests and verify they fail**

Run: `npm test -- test/computation/navigation test/computation/battle-simulator.test.js test/computation/goal-planner.test.js test/computation/priority-scheduler.test.js`

Expected: FAIL because the migrated navigation and simulation modules are absent.

- [ ] **Step 3: Migrate generic navigation code**

Move reusable map/UI/NavMesh/projection/pathfinding code from the old project under `src/computation/navigation`. Preserve the `map-2.5d` coordinate contract, independent NavMesh files, configurable movement targets, navigation-chain output, and registry-based navigator selection. Keep all game-specific coordinates in package data.

- [ ] **Step 4: Implement fixed-timestep battle simulation**

Implement `BattleSimulator` with movement, NavMesh collision, attack-range checks, cooldown timers, death/respawn state, objective events, and seeded branch execution. Use rule data from the current `WorldState` package snapshot. Return predicted trajectories, events, risk score, probability/confidence, and `rulesetId`; do not execute commands.

- [ ] **Step 5: Implement goal expansion and priority handoff**

Allow a battle rule to produce `retreat-to-safe-tower`, then let the map navigator calculate the route. Select only one executable plan at a time, but retain all previews and alerts for visualization.

- [ ] **Step 6: Run navigation tests**

Run: `npm test -- test/computation/navigation test/computation/battle-simulator.test.js test/computation/goal-planner.test.js test/computation/priority-scheduler.test.js`

Expected: all path, chain, simulation, goal, and priority tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/computation/navigation src/computation/battle-simulator.js src/computation/goal-planner.js src/computation/priority-scheduler.js test/computation/navigation test/computation/battle-simulator.test.js test/computation/goal-planner.test.js test/computation/priority-scheduler.test.js
git commit -m "feat: add navigation planning and battle simulation"
```

### Task 6: Add alerts and command-safe execution

**Files:**
- Create: `src/computation/alert-engine.js`
- Create: `src/execution/command.js`
- Create: `src/execution/adb-client.js`
- Create: `src/execution/browser-executor.js`
- Create: `src/execution/navigator-executor.js`
- Create: `src/execution/alert-sinks.js`
- Create: `src/execution/index.js`
- Create: `test/computation/alert-engine.test.js`
- Create: `test/execution/command.test.js`
- Create: `test/execution/adb-client.test.js`
- Create: `test/execution/navigator-executor.test.js`

**Interfaces:**
- `AlertEngine.evaluate(worldState, preview, now) -> Alert[]`
- `AlertEngine.clear(worldState, now) -> Alert[]`
- `CommandValidator.validate(command, worldState) -> ValidationResult`
- `CommandExecutor.execute(command, context) -> CommandResult`
- `AlertSink.emit(alert) -> Promise<void>`

- [ ] **Step 1: Write alert and execution safety tests**

Test alert severity, `forMs`, `clearWhen`, cooldown, deduplication, and priority. Test that an expired command, a command built from an old `stateVersion`, a command below confidence threshold, and a command when execution is disabled are rejected without an ADB call. Test dry-run and fake ADB execution separately.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- test/computation/alert-engine.test.js test/execution`

Expected: FAIL because alert and execution modules are absent.

- [ ] **Step 3: Implement alert evaluation**

Evaluate restricted package expressions against a read-only context. Track active alert instances by ID, require the configured duration before raising, suppress repeats until cooldown expires, and emit clear events when the clear expression becomes true. Include `sourceNavigator`, `stateVersion`, `gameTime`, confidence, and optional suggested goal/command.

- [ ] **Step 4: Migrate and harden execution**

Move the reusable ADB client and navigator executor under `src/execution`. Add browser executor contracts without browser-only imports in Node tests. Validate tap/swipe coordinates, joystick radius, state version, expiry, dry-run, cancellation, and rate limits. Execution must not import recognition or computation implementations; it consumes command objects only.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- test/computation/alert-engine.test.js test/execution`

Expected: all alert and command safety tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/computation/alert-engine.js src/execution test/computation/alert-engine.test.js test/execution
git commit -m "feat: add alert engine and safe command executors"
```

### Task 7: Add the continuous runtime scheduler

**Files:**
- Create: `src/runtime/navigation-runtime.js`
- Create: `src/runtime/navigation-discovery.js`
- Create: `src/runtime/runtime-session.js`
- Create: `src/runtime/event-log.js`
- Create: `src/runtime/runtime-config.js`
- Create: `test/runtime/navigation-runtime.test.js`
- Create: `test/runtime/navigation-discovery.test.js`
- Create: `test/runtime/runtime-session.test.js`
- Create: `test/runtime/event-log.test.js`

**Interfaces:**
- `NavigationRuntime.start() -> RuntimeStatus`
- `NavigationRuntime.tickOnce() -> TickResult`
- `NavigationRuntime.stop(reason) -> RuntimeStatus`
- `NavigationDiscovery.accept(observation, actionResult, context) -> { operations, candidateState, confidence }`
- `RuntimeSession.snapshot() -> RuntimeSnapshot`
- `EventLog.append(event) -> Promise<void>`

- [ ] **Step 1: Write fake-clock runtime tests**

Test the sequence `frame -> recognition -> clock -> fusion -> tracking -> discovery -> simulation -> alerts -> plan -> command validation -> optional execution`. Test different sensor intervals, OCR trigger-only calls, state-version advancement, command expiry, five consecutive abnormal observations, cancellation, and deterministic replay with recorded observations. Test that discovery only produces normal package operations and never writes a package file directly.

- [ ] **Step 2: Run runtime tests and verify they fail**

Run: `npm test -- test/runtime`

Expected: FAIL because runtime modules are absent.

- [ ] **Step 3: Implement the scheduler**

Use a monotonic timer and configured intervals. Each tick obtains a frame from a `FrameSource`, invokes only the sensors enabled for the active scenario, applies the observation to `WorldStateStore`, passes stable observations and the last command result to `NavigationDiscovery`, submits returned operations through the same `NavigationDataService.apply()` used by HTTP clients, advances predictions at 100ms, evaluates alerts, selects a plan, and sends a command only when `execution.enabled` is true. Persist events and state versions for later preview and debugging.

Implement `NavigationDiscovery` with a stable observation signature, a state deduplication window, and transition candidates based on `previousSignature + actionResult + currentSignature`. Mark generated states/transitions as candidates and keep semantic goal naming outside discovery. For map observations, emit ordinary operations containing position, region, landmark, and motion-sample data for the NavMesh builder.

- [ ] **Step 4: Run runtime tests**

Run: `npm test -- test/runtime`

Expected: all scheduler, discovery, session, event log, interval, stale-state, and replay tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/runtime test/runtime
git commit -m "feat: add time-driven navigation runtime and discovery"
```

### Task 8: Expose the normal navigation-data and runtime HTTP API

**Files:**
- Create: `src/server/navigation-http-service.js`
- Create: `src/server/http-router.js`
- Create: `src/server/index.js`
- Create: `src/cli.js`
- Create: `test/server/navigation-http-service.test.js`
- Create: `test/server/http-router.test.js`
- Create: `test/cli/cli.test.js`

**Interfaces:**
- `createNavigationHttpService({ packageService, runtime, auth }) -> { handler, close }`
- `POST /api/v1/packages/:id/operations`
- `POST /api/v1/packages/:id/validate`
- `POST /api/v1/packages/:id/publish`
- `POST /api/v1/navmesh/:id/observations`
- `POST /api/v1/navmesh/:id/rebuild`
- `GET /api/v1/runtime/state`
- `POST /api/v1/runtime/observations`
- `POST /api/v1/runtime/simulate`
- `GET /api/v1/runtime/alerts`
- `GET /api/v1/runtime/chain`
- `POST /api/v1/runtime/command`

- [ ] **Step 1: Write HTTP contract tests**

Test that a regular JSON client can add a rule, goal, flow, alert, simulation parameter, or map observation through the same endpoint. Test author/source/base revision, validation diagnostics, publication, stale command rejection, and default execution-disabled behavior. Do not create an endpoint named `llm`, `agent`, or `research`.

- [ ] **Step 2: Run server tests and verify they fail**

Run: `npm test -- test/server test/cli`

Expected: FAIL because the new server and CLI modules are absent.

- [ ] **Step 3: Implement the HTTP service**

Use the package service for all mutations. The server must not parse web pages or make special decisions based on `author.kind`; it forwards ordinary data, validates revisions, and returns JSON diagnostics. Runtime endpoints return `stateVersion`, `gameTime`, confidence, alerts, previews, chains, and commands. Keep authentication behind an injectable `auth` interface so future AASC authentication can be added without changing package semantics.

- [ ] **Step 4: Implement CLI wiring**

Wire `nav-check`, `nav-chain`, `nav-map-build`, and `nav-serve` to the same repository, computation, runtime, and HTTP interfaces. Add a `--dry-run` default for device execution and explicit `--enable-execution` for live commands.

- [ ] **Step 5: Run server tests and build**

Run: `npm test -- test/server test/cli && npm run build`

Expected: all API/CLI tests pass and the build exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add src/server src/cli.js test/server test/cli
git commit -m "feat: expose standard navigation data and runtime APIs"
```

### Task 9: Add configuration data and migrate reusable assets

**Files:**
- Create: `packages/honor-of-kings.nav.md`
- Create: `navmesh/maps/honor-of-kings-25d.navmesh`
- Create: `models/README.md`
- Create: `data/rules/README.md`
- Create: `docs/migration.md`
- Create: `test/package/honor-of-kings-package.test.js`

**Interfaces:**
- `NavigationPackageRepository.load('packages/honor-of-kings.nav.md')`
- `NavMeshStore.load('honor-of-kings-25d')`
- `NavigationDataService.validate('honor-of-kings', revision)`

- [ ] **Step 1: Write migration fixture tests**

Test that the Honor of Kings package is data-only, declares UI/map/battle navigators, references an independent NavMesh, contains no flow-directory dependency, and can be loaded by the new package repository. Test that shared source files contain no Honor of Kings coordinates or package IDs.

- [ ] **Step 2: Run the migration test and verify it fails**

Run: `npm test -- test/package/honor-of-kings-package.test.js`

Expected: FAIL because the new package and NavMesh files are absent.

- [ ] **Step 3: Import only reusable data**

Copy the current package structure into `packages/honor-of-kings.nav.md`, preserving Base64 images and manual-login declarations. Copy the independently generated `moba-25d` NavMesh into `navmesh/maps`. Keep the current map data explicitly marked as a training/sample revision with its coordinate projection and source session. Do not copy the old `flows/` directory.

- [ ] **Step 4: Run migration checks**

Run: `npm test -- test/package/honor-of-kings-package.test.js && node src/cli.js nav-check --file packages/honor-of-kings.nav.md`

Expected: the package test passes and diagnostics are empty.

- [ ] **Step 5: Commit**

```bash
git add packages navmesh models data/rules docs/migration.md test/package/honor-of-kings-package.test.js
git commit -m "feat: add package and independent navmesh data"
```

### Task 10: Document operations and complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/usage.md`
- Create: `docs/operations/runtime-loop.md`
- Create: `docs/operations/navigation-api.md`
- Create: `docs/operations/browser-host.md`
- Create: `test/integration/fake-device-flow.test.js`

**Interfaces:**
- Document the exact startup command, dry-run command, package mutation request, simulation request, chain request, and optional ADB execution request.
- Provide a fake-device integration fixture that drives one observation through recognition, computation, alerting, planning, and dry-run execution.

- [ ] **Step 1: Write the fake-device integration test**

Use a fake frame source, fake recognition adapter, fake clock, a small NavMesh, a tracked enemy unit, and a fake executor. Assert that an enemy-nearby observation raises one warning, a retreat goal produces a map route, the chain is returned before execution, and dry-run produces no device call.

- [ ] **Step 2: Run the integration test and verify it fails**

Run: `npm test -- test/integration/fake-device-flow.test.js`

Expected: FAIL until all layer wiring is connected.

- [ ] **Step 3: Implement the integration wiring and documentation**

Document the three runtime layers, the package/data API used by a human or large-model client, the time-aware state fields, the preview/alert flow, and the explicit execution enable switch. Include examples using `/mnt/aasc-hie` and the Honor of Kings training package without claiming that its current sample map is a production-accurate world model.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm test
npm run build
node src/cli.js nav-check --file packages/honor-of-kings.nav.md
node src/cli.js nav-chain --file packages/honor-of-kings.nav.md --goal-id enter-training-camp
git status --short
```

Expected: all tests pass, build exits 0, package diagnostics are empty, the chain contains the configured training-entry nodes, and the final status contains only intended AASC-HIE project files.

- [ ] **Step 5: Commit**

```bash
git add README.md docs test/integration
git commit -m "docs: document aasc-hie runtime and verification"
```
