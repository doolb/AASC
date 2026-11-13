# AASC-HIE Autonomous Navigation Completion Plan

> **For agentic workers:** Execute this plan inline, task-by-task. Do not use subagents. Each task must keep the project in a tested state.

**Goal:** Complete the AASC-HIE biologically inspired autonomous behavior loop from externally selected goals through progress tracking, navigation-chain inspection, gap repair, safe device execution, and 2.5D/3D navigation.

**Architecture:** Keep navigation definitions in Markdown packages and keep runtime-selected state outside the package. Recognition only produces observations; computation manages world state, goals, planning, NavMesh, simulation, and alerts; execution validates and performs commands. Instinct, muscle-memory, and intelligence layers communicate through plans, events, and `NavigationGap` records.

**Tech Stack:** Pure JavaScript ESM, Node.js, Vitest, dependency-free HTTP router, OpenCV.js, ONNX Runtime Web, injected ADB/browser adapters, JSON NavMesh resources.

**Spec:** `docs/superpowers/specs/2026-09-05-aasc-hie-architecture-design.md` and `README.md`

## Global Constraints

- Do not hard-code a game, device package, coordinate, account, or game-specific rule in core code.
- Use configuration and navigation packages for goals, states, flows, matches, commands, scenarios, and model selection.
- Keep execution disabled by default; all device actions pass through validation and injected adapters.
- Keep OCR conditional and external; ordinary stable UI matching uses OpenCV/template matching.
- Store package images as Base64 in Markdown; store generated NavMesh files independently.
- Static frames may build map observations but must not produce velocity estimates; velocity requires timestamped multi-frame input.
- Use TDD for every behavior change: failing test, minimal implementation, focused test, full regression.
- Do not use subagents.

## Current Baseline

Already implemented and verified: recognition/computation/execution boundaries, UI/map/2.5D/3D navigator primitives, NavMesh build/store, GoalPlanner, navigation chains, priority scheduling, alerts, runtime loop, autonomy layers, `NavigationGap`, `GoalManager`, `ProgressStore`, and external active-goal set/get/clear control.

### Task 1: Complete Goal Lifecycle and Progress Evaluation

**Files:**
- Modify: `src/computation/goal-manager.js`
- Modify: `src/computation/progress-store.js`
- Modify: `src/runtime/navigation-runtime.js`
- Test: `test/computation/progress-store.test.js`
- Test: `test/runtime/navigation-runtime.test.js`

**Interfaces:**
- `GoalManager.evaluate(worldState, goal)` returns `{ status, completed, progress, children }`.
- `GoalManager.next(worldState, goal)` returns the next incomplete low-level goal or `undefined`.
- `ProgressStore.record(goal, patch, at)` remains the only progress mutation entry point.
- `NavigationRuntime` records completion after each observation and clears or advances the active goal only when configured.

- [x] Add failing tests for success expressions, compound-goal completion, incomplete child selection, and daily reset during a running session.
- [x] Run `npm test -- test/computation/progress-store.test.js test/runtime/navigation-runtime.test.js` and confirm the new assertions fail.
- [x] Implement evaluation and `next()` without changing existing `GoalPlanner` chain behavior.
- [x] Add runtime options `autoAdvanceGoals` and `autoClearCompletedGoal`, both defaulting to `false` for compatibility.
- [x] Run focused tests, then `npm test -- --reporter=dot`.
- [x] Update `README.md` with the lifecycle options and commit only this task's files.

### Task 2: Expose Goal State and Progress over HTTP

**Files:**
- Modify: `src/server/navigation-http-service.js`
- Modify: `src/server/http-router.js`
- Test: `test/server/navigation-http-service.test.js`

**Interfaces:**
- `GET /api/v1/runtime/goals` returns all configured goals with progress and active state.
- `GET /api/v1/runtime/goals/:id` returns one goal tree.
- `POST /api/v1/runtime/goals/:id/progress` calls `GoalManager.record(goal, body.patch)`.
- `POST /api/v1/runtime/goals/:id/pause` and `/resume` update runtime goal control state.

- [x] Add route tests for authenticated reads, progress mutation, unknown goal, and missing manager returning `503`.
- [x] Run the focused HTTP tests and verify failure before implementation.
- [x] Implement routes using injected `runtime.goalManager` and `runtime.activeGoal`; do not introduce a second goal store in the HTTP layer.
- [x] Add route documentation and request/response examples to `README.md`.
- [x] Run the full test suite and `npm run build`.

### Task 3: Return and Validate the Active Navigation Chain

**Files:**
- Modify: `src/runtime/navigation-runtime.js`
- Modify: `src/server/navigation-http-service.js`
- Modify: `src/cli.js`
- Test: `test/runtime/navigation-runtime.test.js`
- Test: `test/server/navigation-http-service.test.js`
- Test: `test/cli/cli.test.js`

**Interfaces:**
- `NavigationRuntime.getChain(options)` returns the current goal tree, selected fragment, current step, and executable flag.
- `NavigationRuntime.getCommand(options)` returns one validated candidate command without executing it.
- `GET /api/v1/runtime/chain` calls `runtime.getChain()`.
- `POST /api/v1/runtime/command` supports `{ execute: false }` preview independently of the global execution switch.

- [x] Add tests for active goal chain, child fragment selection, blocked chain, and dry-run command output.
- [x] Confirm tests fail because runtime methods are absent.
- [x] Implement methods by reusing `GoalManager`, `NavigationChainBuilder`, `PriorityScheduler`, and `CommandValidator`.
- [x] Ensure chain generation never mutates progress and never executes a command.
- [x] Add CLI `nav-chain --active-goal` and update HTTP route behavior.
- [x] Run full regression and build checks.

### Task 4: Make NavigationGap a Repair Queue

**Files:**
- Create: `src/runtime/navigation-gap-queue.js`
- Modify: `src/computation/autonomy-layers.js`
- Modify: `src/runtime/navigation-runtime.js`
- Modify: `src/package/navigation-data-service.js`
- Test: `test/runtime/navigation-gap-queue.test.js`
- Test: `test/runtime/navigation-runtime.test.js`

**Interfaces:**
- `NavigationGapQueue.report(gap)` deduplicates by goal/state/reason and tracks attempts.
- `NavigationGapQueue.list(options)` returns pending gaps ordered by priority and age.
- `NavigationGapQueue.resolve(id, resolution)` closes a gap without directly executing commands.
- Intelligence receives `{ gaps, worldState, activeGoal }` and returns candidate `updates`.

- [x] Test deduplication, retry count, resolution, and configurable retry-limit escalation.
- [x] Implement the queue as runtime state with an injected persistence adapter.
- [x] Validate intelligence updates with `NavigationDataService.validateOperations` before optional application.
- [x] Keep `applyAutonomyUpdates` disabled by default; record rejected updates as alerts.
- [x] Expose pending gaps through `GET /api/v1/runtime/gaps`.
- [x] Run all tests and inspect `git diff --check`.

### Task 5: Integrate Safe ADB and Manual Handoff Execution

**Files:**
- Modify: `src/execution/adb-client.js`
- Modify: `src/execution/navigator-executor.js`
- Modify: `src/runtime/navigation-runtime.js`
- Test: `test/execution/adb-client.test.js`
- Test: `test/execution/navigator-executor.test.js`
- Test: `test/integration/fake-device-flow.test.js`

**Interfaces:**
- `CommandExecutor.execute(command, context)` remains the only device-action entry point.
- `manual` commands return `{ executed: false, reason: 'manual-handoff' }` and pause automatic progression.
- Failed or expired commands produce runtime events and contribute to the configured failure threshold.

- [x] Add fake-device tests for tap, swipe, joystick movement, manual login, cancellation, expiration, and rate limits.
- [x] Verify failing assertions before changes.
- [x] Implement manual handoff and runtime pause/resume without bypassing validation.
- [x] Add ADB frame source configuration and explicit device selection; never auto-select an unintended device.
- [x] Run integration and full tests with execution disabled by default.

### Task 6: Complete Dynamic 2.5D/3D NavMesh Reconstruction

**Files:**
- Modify: `src/recognition/frame-source.js`
- Modify: `src/recognition/yolo-detector.js`
- Create: `src/recognition/depth-source.js`
- Modify: `src/computation/navigation/navmesh-builder.js`
- Modify: `src/computation/navigation/navmesh-store.js`
- Test: `test/recognition/depth-source.test.js`
- Test: `test/computation/navigation/pathfinder.test.js`
- Test: `test/package/navigation-package-assets.test.js`

**Interfaces:**
- `DepthSource.estimate(frame, options)` returns depth metadata and a confidence value.
- `NavMeshBuilder.addObservation(observation)` accepts road, water, obstacle surfaces/volumes and optional motion samples.
- `NavMeshBuilder.build({ observations, spaceModel })` returns a versioned NavMesh.
- Static observations never create velocity; timestamped observations may create motion/trajectory metadata.

- [x] Add tests for static-frame behavior, multi-frame motion, semantic regions, obstacle volumes, and persisted revisions.
- [x] Confirm tests fail before implementing new adapters.
- [x] Add injectable depth providers; keep AnyDepth/ONNX as adapters rather than mandatory dependencies.
- [x] Add configured YOLO segmentation model selection and confidence thresholds through an injectable segmentation decoder.
- [x] Preserve separate `data/navmesh/maps/*.navmesh` resources.
- [x] Run deterministic reconstruction tests; do not require a real game device in CI.

### Task 7: Runtime Map Localization and Movement Feedback

**Files:**
- Create: `src/computation/navigation/localizer.js`
- Modify: `src/computation/navigation/map-navigator.js`
- Modify: `src/computation/world-state.js`
- Modify: `src/runtime/navigation-runtime.js`
- Test: `test/computation/navigation/localizer.test.js`
- Test: `test/integration/fake-device-flow.test.js`

**Interfaces:**
- `Localizer.update(observation, map)` returns `{ position, confidence, method, motion }`.
- Supported methods are configured key-object matching, OpenCV matching, and optional ORB/multi-frame localization.
- `NavigationRuntime` feeds movement feedback into world state and stops movement when localization confidence is below threshold.

- [x] Test key-object localization, velocity-assisted updates, confidence decay, and recovery after lost localization.
- [x] Implement localization without requiring ORB-SLAM3 for ordinary runtime operation.
- [x] Add movement speed/configuration to map navigation and persist accepted motion samples during mapping only.
- [x] Connect low-confidence localization to InstinctLayer stop behavior.
- [x] Run full tests and verify dry-run output.

### Task 8: Battle Navigator and Time-Driven Alerts

**Files:**
- Modify: `src/computation/battle-simulator.js`
- Modify: `src/computation/alert-engine.js`
- Create: `src/computation/battle-navigator.js`
- Modify: `src/computation/priority-scheduler.js`
- Test: `test/computation/battle-navigator.test.js`
- Test: `test/computation/battle-simulator.test.js`
- Test: `test/computation/alert-engine.test.js`

**Interfaces:**
- `BattleNavigator.plan(worldState, goal)` returns combat, retreat, escape, or auxiliary-objective plans.
- Battle objectives may complete without the terminal victory objective when configured.
- Alerts are time-driven, priority ordered, and may delegate escape movement to map navigation.

- [x] Add tests for victory, escape, skill-count auxiliary goals, cooldown timing, death, retreat, and map fallback.
- [x] Implement configured battle units/rules and deterministic simulation previews.
- [x] Merge battle and map scenarios through existing priority scheduling.
- [x] Expose active alerts and selected battle chain via existing runtime endpoints.
- [x] Run full tests and build.

### Task 9: Operational Documentation and Example Package

**Files:**
- Modify: `README.md`
- Modify: `docs/usage.md`
- Modify: `docs/operations/runtime-loop.md`
- Modify: `docs/operations/navigation-api.md`
- Modify: `data/packages/example.nav.md`
- Test: `test/package/package-validator.test.js`

- [x] Document the final package schema and external active-goal control.
- [x] Add a complete example with one compound daily goal, two child flows, one manual handoff, one gap repair candidate, and one NavMesh reference.
- [x] Document dry-run, authentication injection, execution enablement, and manual account login.
- [x] Document chain preview versus command execution.
- [x] Run package validation and full regression.

## Final Verification

- [x] Run `npm test -- --reporter=dot`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
- [x] Verify execution remains disabled unless explicitly enabled.
- [x] Verify no game-specific behavior has entered reusable core classes.
- [x] Update README project status to distinguish implemented behavior from future adapters.
