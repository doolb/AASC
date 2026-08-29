# Display Listening Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each display’s listening switch, live listening state, and latest ASR text visible directly in the control display list.

**Architecture:** Extend the existing `DeviceList` rendering and WebSocket handling. Reuse `voiceRecording`/`updateCapabilities` for control, `voiceStatus`/`voiceConversationState` for state, and `voiceInput` for the per-display latest text cache.

**Tech Stack:** Browser JavaScript/HTML/CSS, WebSocket JSON messages, Node test runner.

**Spec:** `docs/spec/display-voice-conversation.md`

## Global Constraints

- Preserve existing capability-editor behavior and voice command routing.
- Escape ASR text before inserting it into `innerHTML`.
- Keep only one latest ASR record per display in browser memory.
- Do not add a new server control protocol.

---

### Task 1: Write and run failing UI contracts

**Files:**
- Create: `tests/display-list-voice-status.test.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`

- [x] Assert the display list contains a direct listening control and state/recent-text rendering hooks.
- [x] Assert the WebSocket handler forwards `voiceInput` to `DeviceList` while preserving `Chat` handling.
- [x] Run `node --test tests/display-list-voice-status.test.js` and confirm failure against the current implementation.

### Task 2: Implement direct listening control and status rendering

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/device-list.js`
- Modify: `src/apps/web-mediacenter/ui/public/css/upload.css`

- [x] Add a per-display latest-input cache and safe HTML escaping.
- [x] Render a direct listening toggle, state label, and latest text under each display item.
- [x] Send merged `updateCapabilities` with only `voiceRecording` changed when the toggle is clicked.

### Task 3: Handle ASR updates and preserve behavior

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`

- [x] Update the matching display’s latest text on each `voiceInput`.
- [x] Continue calling `Chat.handleDisplayVoiceInput(data)`.
- [x] Clear stale cache entries for offline displays only.

### Task 4: Verify and record

**Files:**
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [x] Run Node static contracts and relevant UI regressions.
- [x] Run syntax checks and `git diff --check`.
- [x] Update task execution results and design/spec notes.
