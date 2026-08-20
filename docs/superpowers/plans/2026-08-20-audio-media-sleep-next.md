# Audio Media and Sleep Manual Next Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WAV/OGG/MP3 as first-class media and make manual playlist next wake a sleeping display for temporary playback.

**Architecture:** Use an independent `audio` media type with a dedicated display-side audio element and `audioProgress` WebSocket message. Preserve the existing sleep guard for automatic playlist timers; only the manual `playlistControl(next)` path invokes temporary activation before advancing.

**Tech Stack:** Node.js, Express, WebSocket, native HTML media elements, Node test runner, Puppeteer integration tests.

**Spec:** `docs/spec/audio-media.md`

## Global Constraints

- Support exactly `.wav`, `.ogg`, and `.mp3` as `audio` media types.
- Use `audio/wav`, `audio/ogg`, and `audio/mpeg` for proxy MIME responses.
- Automatic playlist next remains intercepted during sleep and must not advance or queue.
- Manual playlist next calls `activateTemporarily()` and then advances immediately.
- Use `const`/`let`, async/await, try-catch, and Chinese detailed comments for new code.
- Update `docs/todo.md`, the corresponding design/spec/task documents, and `changelog.md`.

### Task 1: Media type and server contract

**Files:**
- Modify: `src/apps/web-mediacenter/modules/media/media-library-app-service.js`
- Modify: `src/apps/web-mediacenter/modules/media/playlist-app-service.js`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `tests/media-library-app-service.test.js`
- Modify: `tests/playlist-app-service.test.js`

- [ ] Add failing tests for WAV/OGG/MP3 detection and playlist inclusion.
- [ ] Run `node --test tests/media-library-app-service.test.js tests/playlist-app-service.test.js` and verify the new assertions fail.
- [ ] Add `audio` detection, playlist collection, server detection, proxy MIME mapping, `audioProgress` registration, logging suppression, and fallback forwarding.
- [ ] Re-run the focused tests and verify they pass.

### Task 2: Control-side upload, library, preview, and progress

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/upload.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/controls.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/crop.js`
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`

- [ ] Add failing static assertions for audio accept filters, type detection, audio progress handling, and audio preview branch.
- [ ] Run the focused test file and verify failure for missing audio behavior.
- [ ] Implement audio type handling, MIME-preserving uploads, audio placeholder preview/list rows, unified progress and media control text.
- [ ] Run the focused tests and syntax checks.

### Task 3: Display-side audio playback and playlist lifecycle

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Modify: `src/apps/web-mediacenter/ui/public/css/display.css`
- Modify: `tests/display-audio-playlist.test.js` (create)

- [ ] Add a Puppeteer/static regression test for the audio element and current-media audio branch.
- [ ] Add a failing regression test for audio playlist ended handling.
- [ ] Add `#mediaAudio`, showMedia/control/seek/volume/progress branches, and playlist audio ended/error/pause/resume cleanup.
- [ ] Run the display regression test and verify audio assertions pass.

### Task 4: Sleep manual-next regression and final documentation

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Modify: `tests/display-sleep-mode.test.js`
- Modify: `docs/design.md`
- Modify: `docs/spec.md`
- Modify: `docs/design/batch-playlist.md`
- Modify: `docs/spec/batch-playlist.md`
- Modify: `docs/design/display-sleep-mode.md`
- Modify: `docs/spec/display-sleep-mode.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [ ] Add a failing Puppeteer regression for manual next while sleeping: state becomes `active` and index advances; also assert automatic timer remains blocked.
- [ ] Run `node tests/display-sleep-mode.test.js` and verify the new assertion fails before the fix.
- [ ] Make only the manual `next` handler call temporary activation before `playlistNext`; retain the automatic sleep guard.
- [ ] Run the complete focused suite and update the task/changelog/todo/index documents with results.
