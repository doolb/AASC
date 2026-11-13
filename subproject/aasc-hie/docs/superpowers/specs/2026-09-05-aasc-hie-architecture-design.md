# AASC-HIE Architecture Design

**Status:** Proposed

**Project name:** AASC-HIE (AASC Hybrid Interaction Engine)

**Project root:** `/mnt/aasc-hie`

## Goal

Create an independent, pure-JavaScript interaction engine that can observe a game or application, maintain time-aware state, calculate navigation and simulation results, emit alerts, and execute commands through ADB or browser adapters.

The existing `/mnt/AASC/3rd/autohelper-node` project remains unchanged. AASC-HIE receives only the reusable navigation concepts and implementation pieces needed by the new layer boundaries.

## Design principles

- Recognition reports observations; it does not decide what the user should do.
- Computation owns state fusion, prediction, navigation, simulation, priorities, and alerts.
- Execution validates and performs commands; it does not infer game state.
- Game-specific behavior belongs in navigation-package configuration and detector adapters, not in shared JavaScript control flow.
- Every observation and derived value carries `observedAt`, `gameTime`, `confidence`, and freshness information where applicable.
- OCR is optional and is triggered only for configured state values; ordinary UI changes use OpenCV or other visual detectors.
- NavMesh files are independent binary/JSON resources referenced by a Markdown navigation package.
- Simulation is deterministic for the same input snapshot, seed, and configuration.
- External clients, including a large model, use the same navigation-data API as a human or script; there is no privileged rule-research agent or special write path.
- Runtime discovery may generate candidate navigation data from recognized frames, but it must use the same package mutation, validation, revision, and publication service as every other client.

## Layered architecture

```text
FrameSource / BrowserFrameSource
          |
          v
Recognition Layer  ---> Observation
          |
          v
Computation Layer ---> WorldState / Plan / Preview / Alert
          |
          v
Execution Layer  ---> CommandResult
          |
          v
Runtime Scheduler and Event Log
```

### Recognition layer

The recognition layer accepts a frame or external observation and returns normalized observations. It contains:

- frame sources for ADB and browser streams;
- PNG/BMP decoding;
- precompiled OpenCV template and feature matching;
- configurable local YOLO detection and segmentation adapters;
- external OCR client;
- UI, minimap, hero, unit, terrain, and landmark observation adapters;
- observation confidence and freshness normalization.

Recognition adapters must not call ADB input, choose a route, mutate goals, or emit an alert. A detector is selected by package configuration, for example `yolo:enemy-hero` or `opencv:battle-hud`.

### Computation layer

The computation layer contains:

- `WorldStateStore`: current state, immutable snapshots, event history, and state version;
- `ClockModel`: monotonic time, game time, pause/resume, OCR clock calibration, and drift detection;
- `StateFusion`: merges UI, entity, map, OCR, and external observations;
- `UnitTracker`: associates detections, estimates velocity and heading, and expires stale units;
- `NavMeshStore`, projection, pathfinding, and UI/map navigators;
- `BattleSimulator`: fixed-timestep forward simulation with branch previews;
- `GoalPlanner`: converts high-level goals to lower-level navigation goals;
- `PriorityScheduler`: selects the highest-priority active scenario or interrupt;
- `AlertEngine`: evaluates configured rules, debounces them, applies cooldowns, and returns alerts;
- `NavigationChainBuilder`: creates a visualizable chain without executing it.

Rules obtained from documentation or web research are ordinary navigation-package data. A human or external large-model client may search for rules, transform the result into the package schema, and submit it through the normal navigation-data API. The server validates, versions, stores, and publishes the data; it does not need to know whether the caller was a person, script, or large model. Source URLs, version, timestamp, and confidence are optional provenance fields on the submitted data.

### Execution layer

The execution layer contains:

- a common `CommandExecutor` contract;
- ADB tap, swipe, key, and activity adapters;
- browser input adapters for future browser-hosted tasks;
- command validation, dry-run mode, rate limits, cancellation, and execution results;
- optional notification, voice, log, and overlay sinks for alerts.

An execution command has a source navigator, target state version, confidence, expiry time, and safety policy. Expired commands must be rejected rather than executed against an old world state.

## Core contracts

All contracts use plain JavaScript objects so they work in Node.js and browser workers.

```js
recognizer.observe(frame, context)
// -> { observedAt, gameTimeHint, ui, entities, map, values, confidence }

worldStateStore.apply(observation)
// -> { stateVersion, worldState, events }

navigator.getCurrentState(worldState)
navigator.plan(worldState, goal)
navigator.simulate(worldState, options)
navigator.generateInstruction(worldState, plan)
navigator.getNavigationChain(worldState, goal)
// -> state / plan / preview / command / chain

navigationDiscovery.accept(observation, actionResult, context)
// -> { operations, candidateState, confidence }

alertEngine.evaluate(worldState, preview, now)
// -> [{ id, severity, message, source, expiresAt, suggestedGoal, suggestedCommand }]

executor.execute(command, context)
// -> { executed, commandId, stateVersion, reason, timestamp }
```

`WorldState` contains an overlapping UI list and topmost UI state, the self unit, tracked ally/enemy/objective units, map position, active goals, simulation facts, and active alerts. It is not reduced to one mutually exclusive screen state.

## Time and update model

The runtime loop uses two stages:

1. Observe and fuse at the configured sensor cadence.
2. Predict and schedule at a fixed computation cadence.

The default profile is:

- frame and movement observations: 5 Hz;
- unit detection: 5 Hz when the scenario is active;
- ordinary OpenCV UI matching: on every relevant frame;
- OCR: only on a configured trigger or at a low fallback cadence;
- simulation and alert evaluation: every 100 ms;
- command execution: only when the selected plan is newer than the last executed state and passes safety checks.

If the game clock is temporarily unavailable, the clock model advances from monotonic time and lowers confidence. A large clock correction creates a `clock-adjusted` event so predictions can be rebuilt.

## Battle unit model and simulation

Tracked units contain a stable runtime ID, team, category, position, velocity, heading, health, visibility, cooldowns, last-seen time, and uncertainty. Missing detections are extrapolated for a short configured TTL, then marked stale and excluded from high-confidence decisions.

The simulator uses the fused snapshot as input and does not mutate it. A scenario supplies a horizon, fixed timestep, movement model, attack/range rules, cooldown rules, respawn rules, NavMesh, and optional seeded branches. Its output contains predicted trajectories, events, risk scores, and confidence ranges. It must be possible to render the same preview as a navigation chain for inspection before execution.

## Package configuration

Each game or application is described by one Markdown navigation package. The JSON block includes navigators, sensors, entities, clocks, rules, goals, priorities, and alerts. Images remain embedded as Base64 data URLs. NavMesh resources remain separate files.

```json
{
  "metadata": { "id": "game-package", "navigators": ["ui", "map-2.5d", "battle"] },
  "sensors": {
    "enemyHero": { "detector": "yolo:enemy-hero", "intervalMs": 200, "ttlMs": 1200 },
    "battleText": { "detector": "ocr", "trigger": "values.battleTextRequired == true" }
  },
  "clock": { "source": "hud-timer", "fallback": "monotonic", "tickMs": 100 },
  "scenarios": [
    { "id": "battle", "navigators": ["battle", "map-2.5d"], "priority": 80 }
  ],
  "alerts": [
    {
      "id": "enemy-nearby",
      "when": "distance(self, nearestEnemyHero) < 450",
      "severity": "warning",
      "forMs": 300,
      "cooldownMs": 3000,
      "message": "附近有敌方单位，建议撤退",
      "suggestedGoal": "nearest-safe-tower"
    }
  ]
}
```

Expressions are evaluated against a restricted state context. They cannot invoke JavaScript, ADB, network access, or arbitrary file operations.

## Recognition-driven navigation generation

The runtime retains the normal automatic generation path. When a recognized frame is stable, the discovery component creates or updates a candidate state using a deterministic visual signature, observed UI layers, available matches, and the last executed action. When an action is followed by a different stable observation, it proposes a transition or flow edge. For map scenarios it submits recognized positions, regions, landmarks, and motion samples for NavMesh rebuilding.

Discovery produces ordinary package operations and submits them to `NavigationDataService.apply()` in-process. It does not write files directly and does not bypass revision checks. Candidate data may be marked `status: "candidate"` and require validation or publication before a runtime loop can use it. A human, script, or large-model client can enrich or correct the same candidate through the normal API.

Recognition alone cannot infer a user's intention reliably, so automatic discovery generates observable states and candidate transitions; goals, semantic names, and high-level battle strategies remain package configuration or externally supplied data.

## Priority and handoff

Scenarios can run concurrently, but only one command plan is selected at a time. Safety interrupts normally outrank ordinary goals:

```text
critical safety / death / escape: 100
battle response:                 80
map movement:                    60
UI and routine tasks:             40
```

The priority is configurable. A battle navigator can produce a goal such as `retreat-to-safe-tower`; the map navigator then computes the NavMesh route. This keeps battle decisions separate from movement execution.

## Runtime and HTTP boundary

The runtime owns the continuous loop. The HTTP service exposes the same navigation-package data operations to humans, scripts, and large-model clients, plus read-only inspection and controlled command endpoints:

- create or update package states, goals, flows, rules, alerts, and simulation parameters;
- submit map observations and request NavMesh rebuilds;
- validate and publish a package revision;
- submit a frame or observation;
- read the current world state;
- request a simulation preview;
- read current alerts;
- request a navigation chain;
- request the next command;
- execute a command only when explicitly enabled and authorized.

Mutation requests use one common contract with `author`, `source`, `baseRevision`, and an operation payload. A large-model client is not allowed to bypass validation, revision checks, approval, or publication rules.

The server layer depends on computation interfaces and does not import detector internals. Browser clients can run recognition or computation in workers; Node remains an execution host when ADB is required.

## Project layout

```text
/mnt/aasc-hie/
  data/packages/             Markdown navigation packages
  data/navmesh/              independent NavMesh files
  data/models/               local detector model references
  src/
    recognition/             frame sources, OpenCV, YOLO, OCR, observers
    computation/             world state, tracking, simulation, nav, alerts
    execution/               ADB/browser executors and command safety
    runtime/                 scheduler, discovery, sessions, event log
    package/                 Markdown package parser and repository
    server/                  HTTP API
  data/                      all game-specific and mutable runtime resources
  test/                      unit, contract, and fake-device integration tests
  docs/                      design, usage, and operations documentation
```

## Migration and delivery boundaries

The new project is delivered in independently testable stages:

1. Project shell and package loading, with no device access.
2. Recognition contracts and adapters, reusing precompiled OpenCV and external OCR boundaries.
3. Computation contracts: clock, world state, fusion, tracker, navigation, and alerts.
4. Execution contracts and ADB/browser adapters.
5. Battle simulation and preview endpoints.
6. Standard navigation-data mutation, validation, revision, and publication APIs for human, script, and large-model clients.
7. Runtime scheduler, recognition-driven candidate navigation generation, and controlled end-to-end testing with the existing Android device.

The first end-to-end milestone supports observation, map movement, simulation preview, and alert output. Automatic combat skills, perfect enemy intent prediction, and a game-specific trained detector are not prerequisites for the first milestone.

## Verification criteria

- The new project runs independently from `/mnt/AASC/3rd/autohelper-node`.
- Pure computation tests run without ADB, OCR servers, or local model files.
- Fake recognition and fake executors can test the full scheduler deterministically.
- A stale observation cannot produce an executable command.
- A simulation preview and its navigation chain contain the same state version and branch IDs.
- Alert cooldown and clear conditions are deterministic under a fake clock.
- ADB execution is disabled by default and supports dry-run mode.
- Stable recognized frames and action results can produce candidate states/transitions through the normal package mutation service.
- The imported Honor of Kings package is configuration data; shared source files contain no game-specific coordinates or names.
