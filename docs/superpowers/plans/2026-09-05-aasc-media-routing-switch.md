# AASC Media Index, Display-First Routing, and Manual Server Switching Implementation Plan

> **For agentic workers:** Execute inline in this session; no subagents or worktrees.

**Goal:** Implement the three confirmed AASC features without authentication, discovery, nearest-node selection, failover, or media replication.

**Architecture:** Add focused framework services for media index normalization and deterministic task routing. Integrate them into the existing main server and TaskManager, then extend the existing server-list page with validated browser navigation.

**Tech Stack:** Node.js CommonJS, Express, existing MediaLibraryManager/TaskManager/WebSocket protocols, browser JavaScript, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-05-aasc-media-routing-switch-design.md`

## Global Constraints

- Preserve existing media-library HTTP APIs and task:execute WebSocket payloads.
- Only `routing: display-first` or `target: auto` opts into automatic display selection.
- Explicit display/server targets retain their current behavior.
- Do not add authentication, discovery, nearest-node selection, failover, file replication, or third-party dependencies.
- Use `const/let`, async/await, try/catch, and Chinese detailed comments in production code.

---

### Task 1: Media index service and API

**Files:**
- Create: `src/framework/aasc/media-index-service.js`
- Modify: `src/framework/aasc/index.js`
- Modify: `src/apps/server/boot/server-app.js`
- Test: `tests/aasc-media-index.test.js`

- [x] Write failing tests for local index normalization, remote aggregation, and isolated remote failure.
- [x] Run the focused test and verify it fails because the service/API contract is absent.
- [x] Implement local index construction from `MediaLibraryManager.listLibraries/list`, source URL decoration, and bounded remote aggregation.
- [x] Register `GET /api/aasc/media-index` with `scope=local` and aggregate behavior.
- [x] Run focused media-index tests and verify they pass.

### Task 2: Display-first task router

**Files:**
- Create: `src/framework/aasc/task-router.js`
- Modify: `src/framework/aasc/index.js`
- Modify: `src/apps/server/modules/task-engine/task-manager.js`
- Modify: `src/apps/server/boot/server-app.js`
- Test: `tests/aasc-task-router.test.js`

- [x] Write failing tests for capability match, fallback, and explicit target preservation.
- [x] Run the focused test and verify it fails because route resolution is absent.
- [x] Implement `AascTaskRouter.resolve(task)` with display-first/auto opt-in and current-server fallback.
- [x] Inject the resolver into TaskManager and apply it immediately before execution while preserving existing display forwarding.
- [x] Run router and relevant task-engine tests and verify they pass.

### Task 3: Manual server switching UI

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`
- Modify: `src/apps/web-mediacenter/ui/public/js/server-list.js`
- Modify: `src/apps/web-mediacenter/ui/public/css/upload.css`
- Test: `tests/server-list-ui.test.js`

- [x] Write failing tests for connection buttons, current-origin detection, and manual HTTP(S) address validation.
- [x] Run the focused UI test and verify it fails because switching controls are absent.
- [x] Implement URL normalization, localStorage state, safe navigation, current-node rendering, and manual address input.
- [x] Run UI tests and verify they pass.

### Task 4: Documentation, regression, and cleanup

**Files:**
- Modify: `docs/design/aasc.md`
- Modify: `docs/spec/aasc.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Modify: `docs/task/20260905_AASC媒体索引任务路由服务器切换.md`

- [x] Run focused tests, syntax checks, and `git diff --check`.
- [x] Run `npm test`, record any pre-existing failure separately.
- [x] Remove the three completed items from `docs/todo.md` and record verification in `changelog.md`.
