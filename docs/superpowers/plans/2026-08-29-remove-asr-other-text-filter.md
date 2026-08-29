# Remove ASR Other-Text Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the “过滤其他文字” switch and its filtering behavior from the test APK, formal Display APK, web configuration, and server ASR pipeline.

**Architecture:** Keep the existing ASR language selection (`auto`, `zh`, `en`) and denoise/fast multi-speaker behavior. Delete the filter-only language mode, the boolean configuration field, the Android bridge argument, and the Unicode post-processing classes so ASR text is returned after normal trimming only.

**Tech Stack:** Node.js, Express, browser JavaScript/HTML, Kotlin Android, sherpa-onnx, JUnit, Node test runner, Gradle.

**Spec:** `docs/spec/android-native-asr.md`, `3rd/tts-server/docs/spec/android-asr-apk.md`

## Global Constraints

- Preserve unrelated user changes in the dirty worktree.
- Use `const`/`let`, `async`/`await`, and `try-catch` in JavaScript changes.
- Update pseudocode before production code.
- Keep streaming ASR unchanged.
- Keep ordinary language choices `auto`, `zh`, and `en`; reject removed `zh-en-filter` requests.

---

### Task 1: Synchronize design/spec/task documentation

**Files:**
- Modify: `docs/design/android-native-asr.md`
- Modify: `docs/spec/android-native-asr.md`
- Modify: `3rd/tts-server/docs/design/android-asr-apk.md`
- Modify: `3rd/tts-server/docs/spec/android-asr-apk.md`
- Create: `docs/task/2026-08-29_删除ASR其他文字过滤.md`

- [x] Update the current ASR design and pseudocode to describe normal trim-only output and the three retained language modes.
- [x] Record the removed UI/config/bridge fields and affected modules in the task document.

### Task 2: Add failing regression contracts

**Files:**
- Modify: `tests/android-asr-options-integration.test.js`
- Modify: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/AsrLanguageModeTest.kt`
- Modify: `src/apps/android-display/app/src/test/java/com/aasc/display/AsrLanguageModeTest.kt`

- [x] Assert that the formal UI, web configuration object, server pipeline, and Android bridge no longer contain the filter switch or filter mode.
- [x] Assert that `auto`, `zh`, and `en` remain supported and `zh-en-filter` is rejected.
- [x] Run the focused tests and confirm they fail against the current implementation.

### Task 3: Remove the production filtering chain

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Modify: `src/apps/web-mediacenter/ui/public/js/tts.js`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/apps/server/modules/config/config-app-service.js`
- Modify: `config/config.json`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/AsrLanguageMode.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/AsrEngine.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrLanguageMode.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrCoordinator.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/VoiceprintTestCoordinator.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrHttpServer.kt`
- Delete: `src/apps/android-display/app/src/main/java/com/aasc/display/ChineseEnglishTextFilter.kt`
- Delete: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/ChineseEnglishTextFilter.kt`
- Delete: corresponding obsolete filter unit tests

- [x] Remove the checkbox, special language option, API field, and bridge parameter.
- [x] Make all ASR result paths return the recognizer text without script filtering.
- [x] Retain denoise, ordinary language selection, voiceprint segmentation, and streaming ASR.

### Task 4: Run regression tests and synchronize records

**Files:**
- Modify: `tests/android-asr-options-integration.test.js`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Modify: `3rd/tts-server/changelog.md`

- [x] Run focused Node and Kotlin tests, then run the relevant full Android unit tests.
- [x] Run syntax checks and `git diff --check`.
- [x] Record the completed removal and verification evidence.

### Task 5: Build the formal Android APK

**Files:**
- Build: `src/apps/android-display/app`

- [x] Run `npm run build:apk`.
- [x] Verify the APK build exits successfully and no remaining code reference exists outside historical task documentation.
