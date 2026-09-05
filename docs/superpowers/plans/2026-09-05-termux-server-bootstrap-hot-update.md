# Termux Server Bootstrap and Hot Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a verified AASC server-code package and install it on the Termux node through a two-process-compatible Bootstrap with rollback.

**Architecture:** The main server owns a cached release service and exposes a manifest plus streamed gzip package under `/server`. A dependency-free Termux Bootstrap runs the existing launcher in `run` mode and performs stop, staged install, restart, health check, and rollback in `update` mode. Installation is in-place on the existing project root and preserves configuration, resources, dependencies, certificates, and logs.

**Tech Stack:** Node.js built-in `fs`, `crypto`, `http`, `https`, `child_process`, `zlib`; Express; system `tar`; Termux runit `sv`; Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-05-termux-server-bootstrap-hot-update-design.md`, `docs/design/android-termux-server.md`, `docs/spec/android-termux-server.md`

## Global Constraints

- Use `const`/`let`, `async`/`await`, `try-catch`, and Chinese detailed comments in new project code.
- Preserve the existing `server-launcher.js` plus `server-app.js` two-process behavior.
- Package only `src`, `package.json`, and `package-lock.json`.
- Never overwrite Termux `config`, user `res` data and task runtime data, `node_modules`, `logs`, or certificates.
- Use SHA-256 and byte-count verification before stopping the service.
- Keep `/api/subservers`, `/display`, `/upload`, and current WebSocket paths compatible.
- Do not implement authentication, auto-discovery, media synchronization, or task routing in this plan.

### Task 1: Release Package Service

**Files:**
- Create: `src/apps/server/modules/aasc/server-release-service.js`
- Modify: `src/apps/server/boot/server-app.js`
- Test: `tests/server-release-service.test.js`
- Test: `tests/server-api-contract.test.js`

**Interfaces:**
- `new ServerReleaseService({ projectRoot, version, cacheDir })`
- `getManifest()` returns `{ version, size, sha256, packageUrl, files }`.
- `createPackage()` returns `{ filePath, size, sha256 }`.
- Express exposes `GET /server` and `GET /server/package`.

- [x] **Step 1: Write failing release-service and route contract tests.**
- [x] **Step 2: Run `node --test tests/server-release-service.test.js tests/server-api-contract.test.js` and confirm missing module/routes fail.**
- [x] **Step 3: Implement whitelist packaging, cached SHA-256 manifest, safe package streaming, and Express routes.**
- [x] **Step 4: Run the same targeted tests and confirm they pass.**

### Task 2: Termux Bootstrap Lifecycle and Update

**Files:**
- Create: `scripts/termux/aasc-server-bootstrap.cjs`
- Test: `tests/termux-server-bootstrap.test.js`

**Interfaces:**
- `createBootstrap(options)` returns `run()` and `update()`.
- `update()` accepts `serverUrl`, `projectRoot`, `serviceName`, `serviceController`, `fetchImpl`, `healthCheck` and returns `{ success, version, rolledBack }`.
- `serviceController` exposes async `stop()` and `start()`.

- [x] **Step 1: Write failing tests for manifest download, hash/size rejection, whitelist staging and success.**
- [x] **Step 2: Run `node --test tests/termux-server-bootstrap.test.js` and confirm the Bootstrap module is missing.**
- [x] **Step 3: Implement built-in HTTP(S) download, SHA-256 validation, tar staging, whitelist copy, backup, and service restart.**
- [x] **Step 4: Add rollback when health check fails and ensure cleanup never touches preserved directories.**
- [x] **Step 5: Run the Bootstrap targeted tests and confirm success and rollback pass.**

### Task 3: Termux Service Integration and Documentation

**Files:**
- Modify: `docs/design/android-termux-server.md`
- Modify: `docs/spec/android-termux-server.md`
- Create: `docs/task/20260905_Termux服务器代码下发与双进程热更.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

**Interfaces:**
- Document the existing runit `run` script as the two-process entry.
- Document Bootstrap update commands and preserved paths.

- [ ] **Step 1: Add the completed implementation result and exact test commands to the task document.**
- [ ] **Step 2: Remove the completed item from `docs/todo.md` and record the result in `changelog.md`.**
- [ ] **Step 3: Run `node --check`, `git diff --check`, and the full `npm test`.**

### Task 4: Real Termux Acceptance

**Files:**
- No repository source changes; use the connected device at `192.168.1.6:5555`.

**Interfaces:**
- Termux project root: `/data/data/com.termux/files/home/aasc-server-test`.
- Existing service: `/data/data/com.termux/files/usr/var/service/aasc-server-test`.
- Main server: `https://192.168.1.39:8081`.

- [ ] **Step 1: Read current Termux status and back up the remote run script/config before mutation.**
- [ ] **Step 2: Install or start the Bootstrap and start the two-process server.**
- [ ] **Step 3: Verify `/api/status`, `/upload`, `/display`, AASC registration and heartbeat.**
- [ ] **Step 4: Run a valid hot update and verify the new release marker plus service health.**
- [ ] **Step 5: Run an intentionally invalid update and verify old code and health recover.**
- [ ] **Step 6: Stop temporary processes, leave the Termux service in its prior intended state, and record exact evidence.**
