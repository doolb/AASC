# Display Recording Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ASR, single-recording, and real-time recording modes to the control/display voice path, with non-ASR audio returned only to the requesting control client.

**Architecture:** Keep the existing `PcmAudioCapture` as the shared capture primitive. The display chooses one capture purpose at a time; the server owns request routing and timeout cleanup; the control client renders the mode selector and plays single WAV results or schedules real-time PCM in one Web Audio timeline.

**Tech Stack:** Browser JavaScript, WebSocket JSON messages, Web Audio API, existing `PcmAudioCapture`, Node.js `node:test` contract tests.

**Spec:** `docs/design/display-recording.md` and `docs/spec/display-recording.md`

## Global Constraints

- `asr` keeps the existing VAD/ASR behavior and message types.
- `single` and `realtime` never call `/api/asr/recognize`, `audioChunk`, or `voiceInput`.
- Single and real-time recording are capped at 60 seconds.
- Audio remains 16kHz, mono, PCM16/WAV.
- Only the requesting control WebSocket receives recording data.
- All code follows the AASC JavaScript rules: `const`/`let`, `async/await`, `try/catch`, and Chinese comments.

### Task 1: Add red contract tests for the three-mode protocol

**Files:**
- Create: `tests/display-recording-modes.test.js`
- Modify: `tests/display-asr-audio-pipeline.test.js`

**Interfaces:**
- The tests assert `voiceRecordingMode`, `voiceRecordingConfig`, `displayRecordingRequest`, `displayRecordingChunk`, `displayRecordingResult`, and the absence of ASR submission in non-ASR handlers.
- The PCM test exercises the real `PcmAudioCapture` class with a stream-only `onChunk` callback.

- [x] **Step 1: Write the failing tests**

Assert that the source contains the mode selector, server request routing, display request handler, control playback handler, and stream-only PCM callback contract. Add a fake `AudioContext` test that expects a PCM callback when `streamOnly` capture receives an audio process event.

- [x] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/display-recording-modes.test.js tests/display-asr-audio-pipeline.test.js`

Expected: the new mode/protocol assertions fail because the production code does not yet define the new messages or stream callback.

### Task 2: Extend the shared PCM capture primitive

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/pcm-audio-capture.js`
- Test: `tests/display-asr-audio-pipeline.test.js`

**Interfaces:**
- `new PcmAudioCapture({ onChunk(samples, sourceSampleRate), streamOnly })` calls `onChunk` for each captured source chunk.
- `PcmAudioCapture.encodePcm16(samples, sourceSampleRate, targetSampleRate)` returns resampled PCM16 data for real-time transport.

- [x] **Step 1: Implement the minimal callback and stream-only behavior**

Call the optional callback after each accepted audio chunk, skip full-buffer accumulation when `streamOnly` is true, and add PCM16 resampling using the same interpolation rules as `encodeWav`.

- [x] **Step 2: Run the primitive tests**

Run: `node --test tests/display-asr-audio-pipeline.test.js`

Expected: all PCM capture tests pass.

### Task 3: Add server mode state and targeted recording routing

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
- Test: `tests/display-recording-modes.test.js`

**Interfaces:**
- Control messages: `setVoiceRecordingMode`, `requestDisplayRecording`, `stopDisplayRecording`.
- Display messages: `displayRecordingStatus`, `displayRecordingChunk`, `displayRecordingResult`.
- `DisplayRecordingSession` maps `requestId` to `displayId`, `controlSocket`, `mode`, sequence and timeout.

- [x] **Step 1: Add failing assertions for mode state and routing**

Assert that display state defaults to `asr`, display list carries the mode, mode updates persist and notify the target display, and recording chunks/results are sent only to the request owner.

- [x] **Step 2: Implement validation and lifecycle cleanup**

Normalize the three modes, reject `asr` recording requests, reject offline/no-capability/busy targets, install a 60-second timer, validate sequence numbers, and clean up on result, timeout, display disconnect, and control disconnect.

- [x] **Step 3: Run the server contract tests**

Run: `node --test tests/display-recording-modes.test.js`

Expected: server mode and targeted routing assertions pass.

### Task 4: Integrate display capture modes

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Test: `tests/display-recording-modes.test.js`

**Interfaces:**
- `voiceRecordingConfig` changes the active mode without changing the persistent capability switch.
- `displayRecordingRequest(start/stop)` starts or stops a single or stream-only capture session.
- Single mode sends one WAV result after VAD/manual/timeout completion; real-time mode sends PCM16 chunks and a final result.

- [x] **Step 1: Add failing display assertions**

Assert that `asr` keeps `sendAudioForRecognition`, while single and real-time handlers do not call it and do send their dedicated result/chunk messages.

- [x] **Step 2: Implement one-capture-session mode switching**

Refactor the existing capture startup into a shared helper, preserve VAD behavior for ASR and single modes, use stream-only callback capture for real-time mode, and ensure all error/timeout/stop paths release microphone resources.

- [x] **Step 3: Run display regression tests**

Run: `node --test tests/display-recording-modes.test.js tests/display-asr-audio-pipeline.test.js tests/display-voice-listening.test.js tests/display-voice-resource-lifecycle.test.js`

Expected: the new mode tests and existing voice recording tests pass.

### Task 5: Add control UI and audio playback

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/device-list.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`
- Modify: `src/apps/web-mediacenter/ui/public/css/upload.css`
- Test: `tests/display-recording-modes.test.js`

**Interfaces:**
- The selected display's VAD card renders the mode selector and single/realtime start-stop action; tree display nodes keep only the listening toggle.
- WAV results use a revocable object URL and HTML audio fallback.
- Real-time PCM uses one `AudioContext`, a small initial buffer, and monotonic `nextPlayTime`.

- [x] **Step 1: Add failing UI assertions**

Assert mode options, request/stop messages, status updates, WAV playback, PCM scheduling, cleanup and disabled-state handling.

- [x] **Step 2: Implement UI state and playback**

Keep request state keyed by `displayId/requestId`, stop stale sessions, show errors, and never route returned audio through chat or ASR handlers.

- [x] **Step 3: Run UI contract tests**

Run: `node --test tests/display-recording-modes.test.js tests/display-list-voice-status.test.js tests/display-voice-listening.test.js`

Expected: all mode and existing display-list voice tests pass.

### Task 6: Complete documentation, regression, and build verification

**Files:**
- Modify: `docs/design.md`, `docs/spec.md`, `docs/todo.md`, `changelog.md`
- Modify: `docs/design/display-recording.md`, `docs/spec/display-recording.md`, `docs/task/2026-09-11_显示端录音模式与控制端回放.md`

- [x] **Step 1: Record implementation and verification results**

Fill the task test record and changelog with exact commands, pass/fail counts, and any unrelated existing failure.

- [x] **Step 2: Run final checks**

Run: `npm test`, `node --check src/apps/server/boot/server-app.js`, `node --check src/apps/web-mediacenter/ui/public/js/device-list.js`, `node --check src/apps/web-mediacenter/ui/public/js/websocket.js`, and `git diff --check`.

Expected: new and relevant tests pass; any unrelated pre-existing failure is reported explicitly.
