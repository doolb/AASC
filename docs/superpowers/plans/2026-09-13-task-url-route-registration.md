# Task URL Route Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add instance-scoped HTTP route registration so server and display tasks can serve URLs through the AASC service on port 8081 without opening task-specific listeners.

**Architecture:** `TaskRouteRegistry` owns normalized method/path registrations and pending HTTP requests. Server tasks call local handlers through a response adapter; display tasks register handler metadata over WebSocket and receive request/response messages with `routeId` and `requestId`. `llm-server` registers the existing OpenAI-compatible endpoints through the same task route API.

**Tech Stack:** Node.js, Express 4, WebSocket (`ws`), browser WebSocket, Node child display runtime, Node built-in test runner.

**Spec:** `docs/design/task-url-route-registration.md` and `docs/spec/task-url-route-registration.md`

## Global Constraints

- Reuse AASC main HTTP port; default remains `8081`.
- Every WebSocket message contains a `type` field.
- New JavaScript uses `const`/`let`, `async`/`await`, `try`/`catch`, and Chinese detailed comments where behavior is non-obvious.
- Do not expose the Express application object to task code.
- Preserve unrelated dirty worktree changes and do not reset or clean files.
- Update project design/spec/task/todo/changelog documentation with the implementation.

### Task 1: Core Route Registry and TaskManager Lifecycle

**Files:**
- Create: `src/apps/server/modules/task-engine/task-route-registry.js`
- Modify: `src/apps/server/modules/task-engine/task-manager.js`
- Test: `tests/task-route-registry.test.js`

**Interfaces:**
- Produces `TaskRouteRegistry.registerServerRoute()`, `registerDisplayRoute()`, `handleRequest()`, `handleDisplayResponse()`, `unregisterInstance()`, `unregisterDisplay()`, and `destroy()`.
- Produces `TaskManager.handleHttpRoute()`, `handleTaskRouteRegister()`, `handleTaskRouteUnregister()`, and `handleTaskRouteResponse()`.
- Injects `context.registerRoute(route)` into server service tasks.

- [ ] Write tests for server route handling, duplicate conflict, instance cleanup, and pending display failure.
- [ ] Run `node --test tests/task-route-registry.test.js` and observe the expected missing-module failures.
- [ ] Implement route normalization, server response adapter, display pending-request state, timeout and cleanup.
- [ ] Inject route registration into built-in/user service contexts and call cleanup from stop, replacement, display disconnect, delete and destroy paths.
- [ ] Run the focused test again and verify all route registry cases pass.

### Task 2: WebSocket Route Protocol and Display Clients

**Files:**
- Modify: `src/apps/server/modules/task-engine/web-socket-handler.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Modify: `src/apps/voice-display-node/main.js`
- Modify: `src/apps/server/modules/task-engine/task-manager.js`
- Test: `tests/task-route-display-contract.test.js`

**Interfaces:**
- Uses TaskManager route methods from Task 1.
- Display clients send `task:route_register`/`task:route_unregister` and respond to `task:route_request` with `task:route_response`.
- Display service contexts expose `registerRoute(route)` and preserve service stop cleanup.

- [ ] Write static protocol contract tests for browser and Node display handling and message fields.
- [ ] Run the contract tests and observe failures for missing route protocol symbols.
- [ ] Add server WebSocket handlers with display identity and ownership validation.
- [ ] Add browser and Node display route maps, registration acknowledgements, response adapters, request dispatch, cancel and stop cleanup.
- [ ] Include `mode` in forwarded task payloads so service tasks can expose route registration.
- [ ] Run the contract tests and focused task tests.

### Task 3: Express Mount and LLM Gateway Integration

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/apps/server/modules/task-engine/builtin-tasks/llm-server.js`
- Modify: `src/apps/server/modules/task-engine/task-manager.js`
- Test: `tests/task-route-llm-contract.test.js`

**Interfaces:**
- `server-app.js` mounts `taskManager.handleHttpRoute()` after `express.json()` and before fixed `/v1` handlers.
- `llm-server` calls `context.registerRoute()` for the four LLM paths and uses injected `llmHttpHandlers`.
- Existing fixed routes remain fallback-compatible when no task route is registered.

- [ ] Write tests for four LLM route declarations and server app dynamic middleware placement.
- [ ] Run the tests and observe failures before implementation.
- [ ] Inject generic LLM handler callbacks into TaskManager service contexts and register the routes from `llm-server`.
- [ ] Mount the dynamic middleware without changing the main port or fixed fallback routes.
- [ ] Run LLM routing, task registry, and route contract tests.

### Task 4: Documentation, Regression and Final Verification

**Files:**
- Modify: `docs/design.md`
- Modify: `docs/spec.md`
- Modify: `docs/usage.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Modify: `docs/design/android-mnnchat-llm.md`
- Modify: `docs/spec/android-mnnchat-llm.md`
- Modify: `docs/task/2026-09-13_任务URL路由注册与显示端执行.md`

- [ ] Update indexes and current usage text to describe route registration and the current `8081` behavior.
- [ ] Remove the completed item from `docs/todo.md` and record files plus verification in the task document and changelog.
- [ ] Run `node --check` on changed JavaScript files.
- [ ] Run all focused route/LLM/task tests and then `npm test`.
- [ ] Run `git diff --check` and inspect the final diff for unrelated modifications.
