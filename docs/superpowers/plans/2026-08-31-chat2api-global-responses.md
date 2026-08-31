# Chat2API Global Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route AASC ordinary chat, voice, search/LLM tasks, and Pi Agent through the built-in Chat2API `/v1/responses` endpoint and stop the external Chat2API process after live verification.

**Architecture:** Add a shared Responses HTTP/SSE client. `llm-service` maps existing chat session keys to durable Responses conversation state, while `llm.chat` uses one-shot requests. Pi's custom read-only provider uses the installed Pi Responses adapter and translates function calls without exposing tool payloads as text. Existing AI role backends and old profile settings remain unchanged.

**Tech Stack:** Node.js HTTP/HTTPS, JSON files under the existing AASC user config directory, Pi 0.84.2 extension API, existing Node test runner, current task engine.

**Spec:** `docs/superpowers/specs/2026-08-31-chat2api-global-responses-design.md`, `docs/design/chat2api-global-responses.md`, and `docs/spec/chat2api-global-responses.md`

## Global Constraints

- Use the existing built-in Chat2API proxy at `http://127.0.0.1:8083/v1`; do not read `/mnt/Chat2API` at runtime.
- Stop only the exact `/mnt/Chat2API` Electron/npm process tree after live verification; preserve `/home/as/.config/chat2api`.
- Keep AI role Codex/Claude backends and old profile API settings intact.
- Use `const`/`let`, `async`/`await`, `try`/`catch`, and detailed Chinese comments for non-obvious state transitions.
- Preserve existing `/v1/chat/completions` behavior for external clients and existing AASC Chat Completions fallback behavior.
- Do not stage unrelated logs, generated files, APK outputs, or existing user changes.

---

### Task 1: Add the shared Responses client

**Files:**
- Create: `src/external/llm/llm-responses-client.js`
- Create: `src/external/llm/llm-responses-client.test.js`

**Interfaces:**
- `createResponsesClient({ requestImpl, streamImpl, baseUrl, apiKey })` produces `request(body, options)` and `stream(body, onEvent, options)`.
- `request` returns parsed Responses JSON and normalizes HTTP/remote errors.
- `stream` delivers parsed event objects and ends on `[DONE]`.

- [ ] **Step 1: Write failing tests** for base URL normalization, JSON output parsing, SSE event parsing, `[DONE]`, non-2xx errors, and remote `response.failed` errors.
- [ ] **Step 2: Run** `node --test src/external/llm/llm-responses-client.test.js` and confirm the missing module failure.
- [ ] **Step 3: Implement** the client with Node HTTP/HTTPS request handling, JSON body limits, optional Authorization, SSE line buffering, and try/catch error normalization.
- [ ] **Step 4: Run** the focused client tests and verify all pass.

### Task 2: Switch `llm-service` with durable chat session mapping

**Files:**
- Modify: `src/external/llm/llm-service.js`
- Modify: `src/apps/server/modules/config/config-app-service.js`
- Create: `src/external/llm/llm-service-responses.test.js`

**Interfaces:**
- Add normalized chat config fields `protocol`, `responsesBaseUrl`, and `responsesApiKey` with `openai-responses` defaults pointing at `http://127.0.0.1:8083/v1`.
- Add private functions `loadResponsesSessionState`, `saveResponsesSessionState`, `buildResponsesPayload`, and `extractResponsesText`.
- Existing exports `chat` and `chatStream` retain their result/callback contracts.

- [ ] **Step 1: Write failing tests** for default config, first request with full input, continuation with `previous_response_id`, fingerprint reset, non-stream output extraction, stream delta callbacks, and 404 state rebuild.
- [ ] **Step 2: Run** the focused tests and confirm the current Chat Completions-only implementation fails.
- [ ] **Step 3: Add** a private `chat-responses-sessions.json` mapping keyed by `buildChatSessionKey`, loading it at init and writing atomically with existing user-config permissions.
- [ ] **Step 4: Implement** Responses request selection in `chat` while preserving the Pi Agent branch and legacy transport fallback.
- [ ] **Step 5: Implement** Responses SSE handling in `chatStream`, mapping text deltas to current callbacks and saving state only after `response.completed`.
- [ ] **Step 6: Run** focused `llm-service` tests and verify local history, sentence splitting, TTS callbacks, and profile/template isolation remain intact.

### Task 3: Switch the one-shot `llm.chat` task

**Files:**
- Modify: `src/apps/server/modules/task-engine/builtin-tasks/llm-chat.js`
- Create: `src/apps/server/modules/task-engine/builtin-tasks/llm-chat-responses.test.js`

**Interfaces:**
- The task reads the same global chat transport configuration without sharing ordinary chat session state.
- Responses text is returned as `{ success: true, data: { text } }`; stream chunks keep the existing `postStream` contract.

- [ ] **Step 1: Write failing tests** for Responses non-stream and stream task execution, raw/openai prompt conversion, and legacy fallback.
- [ ] **Step 2: Run** the focused task tests and confirm the task always calls `/v1/chat/completions`.
- [ ] **Step 3: Route** the task through the shared Responses client when global protocol is Responses; keep the old HTTP path for explicit legacy mode.
- [ ] **Step 4: Run** task and search-related tests and verify output shape and stream completion markers are unchanged.

### Task 4: Move Pi Agent to `openai-responses`

**Files:**
- Modify: `src/apps/server/modules/chat/pi-readonly-tools.mjs`
- Modify: `src/apps/server/modules/chat/pi-runtime-manager.js`
- Modify: `src/apps/server/modules/chat/pi-runtime-policy.js`
- Create or modify: `src/apps/server/modules/chat/pi-responses-compat.test.js`

**Interfaces:**
- The custom provider exposes `api: 'openai-responses'`, base URL ending at `/v1`, and the same `aasc-openai` model/provider IDs.
- Pi text events map to existing `createChat2ApiCompatibleStream` callbacks.
- Responses function-call output maps to Pi `toolCall`; unsupported tool events become provider errors.

- [ ] **Step 1: Inspect** the installed Pi 0.84.2 compat exports and write a failing compatibility test for `openAIResponsesApi`/`openai-responses` selection.
- [ ] **Step 2: Implement** the Responses provider adapter and pass `responsesBaseUrl`/model/API key from the global profile configuration.
- [ ] **Step 3: Preserve** the read-only tool policy and convert completed `function_call` output into Pi tool-call blocks without adding raw JSON to text.
- [ ] **Step 4: Run** Pi runtime tests and an actual Pi text request against the built-in Responses proxy.
- [ ] **Step 5: Run** an actual Pi read-only tool request and verify the tool loop completes once, with no external Chat2API process involved.

### Task 5: Global configuration and control-plane visibility

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/chat.js`
- Modify: `src/apps/server/boot/server-app.js` only if the existing chat config response needs an explicit status field.
- Modify: relevant UI test file under `src/apps/web-mediacenter/ui/public/js/`

**Interfaces:**
- The control panel shows the active global protocol and Responses base URL as read-only status or a controlled selector.
- Saving the global switch persists through the existing `/api/chat/config` endpoint.

- [ ] **Step 1: Write failing UI contract tests** for showing Responses global mode and preserving profile API fields.
- [ ] **Step 2: Add** the minimal status/config UI; do not expose Provider credentials or allow arbitrary remote routing in the global shortcut.
- [ ] **Step 3: Run** the UI contract tests and verify theme compatibility and profile editing remain unchanged.

### Task 6: Live cutover, external shutdown, and documentation

**Files:**
- Modify: `docs/design/chat2api-global-responses.md`
- Modify: `docs/spec/chat2api-global-responses.md`
- Modify: `docs/task/2026-08-31_Chat2API全局Responses协议切换.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [ ] **Step 1: Run** all focused tests plus `npm run check:chat2api` and the relevant chat/Pi test suites.
- [ ] **Step 2: Set** the persisted global protocol to `openai-responses`, restart the AASC server, and verify the built-in `8083` proxy health.
- [ ] **Step 3: Run** real ordinary non-stream, ordinary stream, voice/search/one-shot, Pi text, Pi tool, and restart-continuation checks.
- [ ] **Step 4: Resolve** the exact `/mnt/Chat2API` process tree, send TERM, wait for exit, and only force-stop remaining descendants in that exact tree if required.
- [ ] **Step 5: Verify** no `/mnt/Chat2API` process remains, `8083/health` remains healthy, and `/home/as/.config/chat2api` still exists.
- [ ] **Step 6: Update** todo/design/spec/task/changelog with test results, run `git diff --check`, stage only feature files, and commit with `feat(chat): switch global transport to responses`.
