# Chat2API Responses Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pi Agent-compatible `POST /v1/responses` endpoint with durable conversation chaining and Provider-specific session fallback.

**Architecture:** A Responses service converts `input`/`instructions` into the existing internal Chat Completions request, loads a durable AASC conversation record, pins Provider/account when possible, and converts the normalized chat result into Responses JSON or SSE. Provider adapters receive optional native state and return updated state; unsupported native continuation falls back to replaying saved history.

**Tech Stack:** Node.js built-in HTTP server, async generators, JSON file data store, Node test runner, existing Axios Provider adapters.

**Spec:** `docs/spec/chat2api-builtin-task.md` and `docs/task/2026-08-31_Chat2APIResponses协议兼容.md`

## Global Constraints

- Preserve existing `/v1/chat/completions`, `/v1/completions`, `/v1/models` behavior.
- Use `const`/`let`, `async`/`await`, `try`/`catch`, and Chinese detailed comments for non-obvious state transitions.
- Do not read `/mnt/Chat2API` at runtime.
- Store Responses session state under the existing private Chat2API data root with directory mode `0700` and file mode `0600`.
- Do not stage unrelated logs, generated files, APK outputs, or existing user changes.

### Task 1: Persist Responses session records

**Files:**
- Modify: `src/apps/server/modules/chat2api/chat2api-data-store.js`
- Create: `src/apps/server/modules/chat2api/chat2api-response-session-store.js`
- Test: `src/apps/server/modules/chat2api/chat2api-data-store.test.js`
- Test: `src/apps/server/modules/chat2api/chat2api-response-session-store.test.js`

**Interfaces:**
- `createChat2ApiResponseSessionStore({ dataStore })` produces `create`, `get`, `findByResponseId`, `save`, and `withLock`.
- A record contains `conversationId`, `providerId`, `accountId`, `actualModel`, `history`, `nativeState`, `latestResponseId`, `createdAt`, and `updatedAt`.

- [x] **Step 1: Write failing tests** for the new `responsesSessions` collection, atomic persistence, response ID lookup, and same-conversation lock ordering.
- [x] **Step 2: Run** `node --test src/apps/server/modules/chat2api/chat2api-response-session-store.test.js` and verify failure because the collection/service is absent.
- [x] **Step 3: Add** `responsesSessions: 'responses-sessions.json'` and store methods with bounded record validation and private file writes.
- [x] **Step 4: Implement** a per-conversation promise queue that releases the lock in `finally` and does not serialize unrelated conversations.
- [x] **Step 5: Run** the focused data-store and session-store tests and verify they pass.

### Task 2: Add Provider session-state plumbing

**Files:**
- Modify: `src/apps/server/modules/chat2api/chat2api-core-adapter.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-provider-adapters.js`
- Test: `src/apps/server/modules/chat2api/chat2api-core-adapter.test.js`
- Test: `src/apps/server/modules/chat2api/chat2api-provider-adapters.test.js`

**Interfaces:**
- `forwardChatCompletion(request, options)` accepts `preferredProviderId`, `preferredAccountId`, and `responseSession`.
- Provider adapter input accepts `responseSession`; adapter output may include mutable `nativeState`.

- [x] **Step 1: Write failing tests** asserting fixed account selection is passed through and Qwen reuses `session_id`/`parent_req_id` while a fresh request uses first-turn values.
- [x] **Step 2: Run** the focused tests and verify failure because options/state are ignored.
- [x] **Step 3: Modify** core selection to honor session Provider/account, pass session state to adapters, and return updated state without changing existing callers.
- [x] **Step 4: Modify** Qwen and confirmed native builders (DeepSeek, Mimo, MiniMax, Qwen AI, Z.ai, Kimi) to use state when available; leave unsupported continuation on history replay.
- [x] **Step 5: Make stream parsers update state from provider response identifiers without consuming the stream twice.
- [x] **Step 6: Run** focused adapter/core tests and verify existing Chat Completions behavior remains green.

### Task 3: Implement Responses conversion service

**Files:**
- Create: `src/apps/server/modules/chat2api/chat2api-responses-service.js`
- Test: `src/apps/server/modules/chat2api/chat2api-responses-service.test.js`

**Interfaces:**
- `createChat2ApiResponsesService({ dataStore, coreAdapter, sessionStore })` produces `createResponse(request)`.
- `createResponse` returns `{ body }` for non-streaming calls and `{ stream }` for streaming calls.

- [x] **Step 1: Write failing tests** for input normalization, conversation creation, previous response lookup, conflict validation, response body shape, and stream event order.
- [x] **Step 2: Run** the focused service tests and verify failure because the service is absent.
- [x] **Step 3: Implement** string/array input conversion, instructions conversion, function-call item conversion, and Chat Completions tool conversion.
- [x] **Step 4: Implement** conversation lookup/creation, history replay, fixed account options, response ID generation, and post-response state persistence.
- [x] **Step 5: Implement** non-stream conversion for assistant text, tool calls, usage, `conversation`, `previous_response_id`, and `output_text`.
- [x] **Step 6: Implement** stream conversion with `response.created`, output text deltas, completed output, final response, and `[DONE]`; persist only after the upstream stream completes.
- [x] **Step 7: Run** the focused service tests and verify they pass.

### Task 4: Expose `/v1/responses` through proxy/runtime

**Files:**
- Modify: `src/apps/server/modules/chat2api/chat2api-runtime.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-proxy-service.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-proxy-service.test.js`

- [x] **Step 1: Write failing route tests** for authenticated non-streaming and streaming `/v1/responses`, root endpoint listing, and error responses.
- [x] **Step 2: Run** the focused proxy tests and verify failure because route is absent.
- [x] **Step 3: Wire** the session store and Responses service in runtime and add the route without changing existing route order or auth rules.
- [x] **Step 4: Add** a Responses SSE writer that preserves event objects and emits the terminal marker exactly once.
- [x] **Step 5: Run** proxy and runtime tests and verify they pass.

### Task 5: Documentation and compatibility verification

**Files:**
- Modify: `docs/design/chat2api-builtin-task.md`
- Modify: `docs/spec/chat2api-builtin-task.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [x] **Step 1: Run** `npm run check:chat2api` from a clean test invocation and verify all existing and new tests pass.
- [x] **Step 2: Run** `node --check` on each changed JavaScript file and `git diff --check`.
- [x] **Step 3: Verify** the route list, session file permissions, restart persistence, account pinning, and no-credential leakage with focused tests.
- [x] **Step 4: Move** the completed item from `docs/todo.md` to the completed section and record the final commit in `changelog.md`.
- [ ] **Step 5: Review** `git diff`/`git status`, stage only the Responses implementation and documents, and commit with `feat(chat2api): add responses compatibility endpoint`.
