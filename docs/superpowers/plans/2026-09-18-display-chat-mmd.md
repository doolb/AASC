# Display Chat and VRM/MMD Layered Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser display chat application that shares the existing control-side chat state and renders VRM/MMD in the same full-screen stage with configurable visual layering.

**Architecture:** Keep the existing WebSocket chat flow and server-authoritative history/session state. Add a display-only chat shell, a three-vrm runtime with local resource caching, and a bounded action adapter that accepts a high-level `mmd.action.plan` plus a small MMDAgent-EX-compatible low-level command subset. Media remains the bottom layer; chat and MMD share one stage, while an interaction layer remains above both.

**Tech Stack:** Existing Node.js/Express/WebSocket server, native HTML/CSS/JavaScript display UI, three.js, three-vrm, mmd-parser, existing chat/session/history services, and existing browser/Android WebView test tooling.

**Spec:** `docs/design/display-chat-mmd.md`, `docs/spec/display-chat-mmd.md`

## Global Constraints

- Use the existing WebSocket chat flow; do not add a separate HTTP chat read/write API.
- Keep the server as the authority for chat history, session switching, stream completion, and deduplication.
- Keep media at the bottom of the stage; chat and MMD occupy the same full-screen viewport.
- Keep the interaction layer above both chat and MMD so the session selector and input cannot be occluded.
- Load VRM directly in the browser; do not run desktop MMDAgent-EX or require PMX in the browser.
- Prefer local/offline resources and verified cache entries before external model URLs.
- Treat action plans and low-level commands as data; never execute scripts, arbitrary URLs, or file-system paths from them.
- Preserve the current global chat context in the first implementation; keep `displayId` optional for later isolation.
- Do not block the first chat response on model loading or complex motion generation.

---

### Task 1: Freeze chat/session and action contracts

**Files:**
- Create: `docs/spec/display-chat-mmd.md` (already saved as the contract reference)
- Modify: existing chat protocol contract tests under `src/` or `test/` after locating the project’s established test path
- Modify: `src/apps/server/boot/server-app.js` only if the current broadcast contract cannot carry display chat context
- Test: existing chat WebSocket/session tests plus new display chat contract tests

**Interfaces:**
- Consumes: current `chatMessage`, `chatChunk`, `chatResponse`, `chatHistory`, `chatSession`, `privateSessions` messages.
- Produces: stable `ChatContext`, request deduplication behavior, role/session snapshot semantics, and the `mmd.action.plan` response field.

- [ ] **Step 1: Record the current message fields and expected authority behavior**

  Confirm that every new or reused message has `type`, that `requestId` is preserved through streaming, and that server snapshots override stale client selections.

- [ ] **Step 2: Add failing contract assertions**

  Assert that two role/session keys do not share history, a repeated `requestId` does not duplicate a message, and a response action plan is separated from the chat text.

- [ ] **Step 3: Implement only the missing normalization or broadcast fields**

  Reuse current server chat services and `config.set`/WebSocket authority patterns. Keep global context behavior unchanged unless a field is strictly required for display chat.

- [ ] **Step 4: Run the focused chat tests**

  Run the project’s existing targeted chat test script from `package.json`; expected result is all existing chat tests plus the new contract assertions passing.

### Task 2: Add the display chat shell and same-stage layout

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Modify: `src/apps/web-mediacenter/ui/public/css/display.css`
- Create: `src/apps/web-mediacenter/ui/public/js/display-chat.js`
- Test: display static contract tests and browser interaction tests

**Interfaces:**
- Consumes: `ChatTarget`, `ChatContext`, existing WebSocket chat messages, and the layer state defined in the spec.
- Produces: object picker, top session selector, message list, send controls, chat visibility toggle, and `setMmdOrder`/`setChatVisible` state hooks.

- [ ] **Step 1: Add the stage containers without changing media element ownership**

  Keep existing media IDs and handlers intact. Add dedicated MMD, chat, and interaction containers with explicit layer order and pointer-event rules.

- [ ] **Step 2: Add the object picker and top session selector**

  Render only server-provided targets. After a target or session click, wait for the authoritative WebSocket snapshot before replacing the current context.

- [ ] **Step 3: Connect display chat to existing WebSocket messages**

  Send the existing `chatMessage` shape with `requestId`, `mode`, target, session, and display routing fields. Render `chatChunk` and `chatResponse` using the project’s existing think/body/TTS split.

- [ ] **Step 4: Implement mobile stage rules**

  Use dynamic viewport units, safe-area padding, ResizeObserver, and visualViewport keyboard inset. Adjust only the chat input area when the keyboard is visible.

- [ ] **Step 5: Run static and browser tests**

  Verify object selection, top session switching, stream rendering, chat hide/show, MMD order toggle, media continuity, and no duplicated message after reconnect.

### Task 3: Implement VRM resource loading and runtime lifecycle

**Files:**
- Create: `src/apps/web-mediacenter/ui/public/js/display-vrm.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html` for runtime script/module loading
- Modify: dependency/build configuration only where three.js, three-vrm, and mmd-parser are already supported by the project’s packaging model
- Test: resource manifest, cache, load failure, disposal, and browser WebGL tests

**Interfaces:**
- Consumes: `ModelProfile`, verified local resource URLs, current role ID, and stage resize events.
- Produces: a loaded VRM instance, model status, disposal hooks, default idle action, and a model-missing fallback that leaves chat/media operational.

- [ ] **Step 1: Define the resource manifest validation assertions**

  Reject an unregistered URL, wrong MIME, size over the configured limit, hash mismatch, and invalid version. Accept a matching local/offline resource.

- [ ] **Step 2: Implement local-first cache lookup**

  Resolve `resourceId + version + sha256` from the local/service cache before considering a configured external source. Preserve author/license metadata with the resource record.

- [ ] **Step 3: Load and normalize VRM**

  Use GLTFLoader with the VRM plugin, remove unnecessary vertices/joints, apply VRM0 orientation handling, bind the model to the current role, and start an idle action.

- [ ] **Step 4: Dispose old runtime instances**

  Stop actions, detach expressions and observers, remove scene references, and retain only verified disk cache entries when switching roles.

- [ ] **Step 5: Test fallbacks and visibility pausing**

  Confirm failed model loading shows a model-unavailable state, hidden MMD pauses its render loop, and chat/media continue in no-WebGL and no-network cases.

### Task 4: Add VMD/VRMA playback and bounded MMDAgent command adapter

**Files:**
- Create: `src/apps/web-mediacenter/ui/public/js/display-mmd-command-adapter.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/display-vrm.js`
- Test: VMD mapping, expression mapping, low-level command whitelist, parameter bounds, and fallback tests

**Interfaces:**
- Consumes: verified VMD/VRMA/FBX resource IDs, normalized VRM bones/expressions, `MmdActionPlan`, and the four supported MMDAgent-like commands.
- Produces: playable animation tracks, expression/phoneme updates, action status, and safe unsupported-command errors.

- [ ] **Step 1: Add motion mapping tests**

  Assert that allowed VMD bones map to normalized VRM bones, allowed morphs map to expressions, and unknown tracks are skipped without failing the whole clip.

- [ ] **Step 2: Implement VMD parsing and clip creation**

  Parse verified VMD data with `mmd-parser`, filter tracks through the resource mapping, and create a browser animation clip for the current VRM.

- [ ] **Step 3: Implement the low-level command adapter**

  Map `MOTION_ADD`, `MOTION_DELETE`, `MODEL_BINDFACE`, and `MODEL_BINDBONE` to the runtime. Reject scripts, URLs, paths, unknown commands, and out-of-range weights/rotations.

- [ ] **Step 4: Implement expression and lip-sync tracks**

  Merge TTS vowel events with active action expressions, then ease back to the default expression when audio ends.

- [ ] **Step 5: Run the motion test group**

  Verify action start/stop, interrupt policy, fallback idle action, expression bounds, and disposal after a role switch.

### Task 5: Connect high-level AI action plans without blocking chat

**Files:**
- Modify: server chat response normalization module where current `chatResponse` data is assembled
- Modify: `src/apps/web-mediacenter/ui/public/js/display-chat.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/display-mmd-command-adapter.js`
- Test: response/action separation, role/session validation, expiry, priority, and failure fallback

**Interfaces:**
- Consumes: `mmd.action.plan` with role/session context and bounded semantic steps.
- Produces: motion playback requests, action status, idle fallback, and a chat response that contains only the normal user-visible body in the message bubble.

- [ ] **Step 1: Add failing plan validation tests**

  Reject a plan for a different role/session, expired plan, unknown resource, excessive steps, script field, or out-of-range intensity.

- [ ] **Step 2: Implement server/client normalization**

  Keep the plan as a structured response field. Never concatenate it into body text, think text, TTS text, or an executable client string.

- [ ] **Step 3: Implement priority and interruption**

  Apply the plan’s interrupt policy to active tracks, schedule parallel expression/lip-sync tracks, and run the defined fallback action on failure.

- [ ] **Step 4: Verify chat latency independence**

  Send a response with a delayed or failed action resource and assert that the body reaches both control and display clients immediately.

### Task 6: Add deferred complex-motion task boundary and full regression

**Files:**
- Modify: task/action contract documentation and server task registration only after the first four runtime tasks pass
- Create: focused tests for `mmd.motion.generate` submission and `motionResourceReady` validation
- Modify: `docs/todo.md`, `changelog.md`, and usage documentation only when implementation is released

**Interfaces:**
- Consumes: structured natural-language motion description and current role/session context.
- Produces: asynchronous task status and a verified cached motion resource; it never delays the initial chat response.

- [ ] **Step 1: Define the async boundary test**

  Assert that submitting a complex-motion request returns a task/request ID immediately and that the later ready event is accepted only for the matching role/session and hash.

- [ ] **Step 2: Implement the minimum submission adapter**

  Submit through the existing task path; do not bind the design to a specific generation model until runtime playback and resource validation are stable.

- [ ] **Step 3: Run end-to-end regression**

  Run targeted chat/WebSocket/display tests, browser tests, Android WebView high-DPI/keyboard tests, and the project’s standard test command from `package.json`.

- [ ] **Step 4: Review the design-to-code delta**

  Update `docs/design/display-chat-mmd.md`, `docs/spec/display-chat-mmd.md`, `docs/task/20260918_显示端聊天与MMD分层设计.md`, `docs/todo.md`, and `changelog.md` so they describe the released behavior rather than the planned behavior.

## Handoff

This plan is saved for a later implementation session. The current request only records the design; no implementation task is started in this turn.
