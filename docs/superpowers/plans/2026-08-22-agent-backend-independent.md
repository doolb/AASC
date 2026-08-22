# Agent Backend Independent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Claude/Codex Agent processes and session handles in a detached backend host so server restarts only reconnect through Unix Socket IPC.

**Architecture:** `server-app` owns `AiRolesService` and a shared IPC client. A detached `agent-backend-host` owns per-role Claude/Codex bridges and forwards JSON Lines responses/events over a user-owned Unix Socket. Existing role, history, WebSocket and TTS protocols remain unchanged above the bridge boundary.

**Tech Stack:** Node.js CommonJS, `node:net`, `node:child_process`, existing Claude/Codex bridge classes, Node test runner.

**Spec:** `docs/design/ai-roles.md`, `docs/spec/ai-roles.md`, `docs/task/2026-08-22_Agent后端独立于服务器进程.md`

## Global Constraints

- Preserve existing user changes in logs and `res/tasks/*/results`.
- Use `const`/`let`, `async/await`, try/catch, and Chinese detailed comments.
- Keep role WebSocket and TTS message contracts backward compatible.
- Do not let the server process directly spawn or hold Agent stdio/FIFO handles in production.

---

### Task 1: IPC transport primitives

**Files:**
- Create: `src/apps/server/modules/ai-roles/agent-backend-host.js`
- Create: `src/apps/server/modules/ai-roles/agent-backend-client.js`
- Test: `src/apps/server/modules/ai-roles/agent-backend-client.test.js`

- [ ] Write tests for an existing Unix Socket host, event forwarding, and reconnecting a new client without stopping the role.
- [ ] Run the focused test and verify it fails because the host/client modules do not exist.
- [ ] Implement the host dispatch loop and client line protocol with stale-socket recovery.
- [ ] Run the focused test and verify all IPC cases pass.

### Task 2: AiRolesService lifecycle integration

**Files:**
- Modify: `src/apps/server/modules/ai-roles/ai-roles-service.js`
- Modify: `src/apps/server/modules/ai-roles/ai-roles-ws-handler.js`
- Modify: `src/apps/server/boot/server-app.js`
- Test: `src/apps/server/modules/ai-roles/ai-roles-service.test.js`

- [ ] Add failing tests for async restore and async stop/delete through a proxy bridge.
- [ ] Run the focused service tests and verify the new cases fail.
- [ ] Inject the shared client, await restore before role list exposure, and await stop/delete IPC commands.
- [ ] Run service, handler, Claude, Codex and role-store tests.

### Task 3: Regression and documentation verification

**Files:**
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Modify: `docs/design/ai-roles.md`
- Modify: `docs/spec/ai-roles.md`
- Modify: `docs/task/2026-08-22_Agent后端独立于服务器进程.md`

- [ ] Run syntax checks and all relevant AI/chat tests.
- [ ] Verify the working tree contains only intended source/test/docs changes plus pre-existing logs/results.
- [ ] Remove the completed item from `docs/todo.md` and record the change in `changelog.md`.
- [ ] Commit source, tests and documentation without staging logs or runtime results.
