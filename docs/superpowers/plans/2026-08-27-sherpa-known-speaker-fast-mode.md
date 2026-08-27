# Sherpa Known Speaker Fast Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Sherpa fast diarization mode that accepts an automatic or known speaker count from 1 to 5 and avoids repeated embedding extraction for the same diarization cluster.

**Architecture:** Keep `SHERPA_MULTI` unchanged for general unknown-speaker testing. Add `SHERPA_MULTI_FAST`; the coordinator passes the requested cluster count to the loaded `OfflineSpeakerDiarization` config and extracts one representative embedding per cluster, while still running ASR for each returned segment.

**Tech Stack:** Kotlin, sherpa-onnx 1.12.35 AAR, Android JVM tests, embedded APK HTML/HTTP API.

**Spec:** `docs/spec/android-voiceprint-test-apk.md`

## Global Constraints

- Speaker count is `AUTO` or an integer from `1` through `5`.
- Invalid speaker counts return HTTP 400 and do not start native inference.
- Existing `SHERPA_SINGLE` and `SHERPA_MULTI` behavior remains compatible.
- Fast mode only reuses speaker embeddings; each output segment keeps its own ASR text and timing.
- Changes must be documented in `docs/design`, `docs/spec`, `docs/task`, `docs/todo.md`, and `changelog.md`.

### Task 1: Add the speaker-count contract and failing tests

**Files:**
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/VoiceprintSpeakerCount.kt`
- Test: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/VoiceprintSpeakerCountTest.kt`
- Modify: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/VoiceprintModeTest.kt`

- [x] Write tests for `AUTO`, counts `1` and `5`, invalid `0`, `6`, and non-numeric input; update mode expectations to include `SHERPA_MULTI_FAST`.
- [x] Run the focused tests and verify they fail because the new value/object is absent.
- [x] Add the minimal enum/object implementation and rerun the focused tests.

### Task 2: Add fast coordinator behavior and API tests

**Files:**
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/VoiceprintTestCoordinator.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/SherpaVoiceprintEngine.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrHttpServer.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/HttpJson.kt`
- Test: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/AsrHttpServerTest.kt`

- [x] Add a failing HTTP contract assertion for the fast mode and a `speakerCount` validation assertion.
- [x] Run the focused tests and confirm the endpoint/page contract is missing.
- [x] Parse `speakerCount` as `AUTO`/`1..5`; reject invalid values with 400.
- [x] Add `SHERPA_MULTI_FAST` dispatch, update the loaded diarization clustering config, and reuse one representative embedding per cluster.
- [x] Serialize the result with the new mode and return the requested count only through the request behavior, not as a new result field.
- [x] Run focused tests and verify they pass.

### Task 3: Update the embedded page and project documents

**Files:**
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrWebPage.kt`
- Modify: `docs/design/android-voiceprint-test-apk.md`
- Modify: `docs/spec/android-voiceprint-test-apk.md`
- Create: `docs/task/2026-08-27_Sherpa快速多段人数上限5.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [x] Add an actual-speaker-count selector with `自动`, `1`, `2`, `3`, `4`, `5` options.
- [x] Send `speakerCount` only for fast multi tests and show the selected mode in the result.
- [x] Record the data flow, constraints, test cases, and performance measurement plan in the project documents.

### Task 4: Verify and commit

- [x] Run `git diff --check` and the Android focused tests/build available in the environment.
- [x] Inspect staged paths and ensure generated logs, caches, and unrelated worktree changes are excluded.
- [ ] Commit the feature with a focused message.
