# Android Offline TTS APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a standalone `3rd/tts-server/android-tts` APK that bundles the Xiaoxiao Embedded Speech model and generates/plays speech without network access.

**Architecture:** A small native Kotlin app copies the 14 bundled model files from APK assets into app-private storage, initializes the existing Embedded Speech SDK with an explicit `null` `AudioConfig`, and serializes synthesis on a background executor. A minimal XML screen owns the text box and button; a MediaPlayer-backed class plays the returned WAV bytes.

**Tech Stack:** Android Gradle Plugin 9.3.1, Kotlin built into AGP, Android SDK 34, Microsoft Cognitive Services Speech Embedded SDK 1.51.2, `azure-core` 1.58.1, JUnit 4.

**Spec:** `3rd/tts-server/docs/spec/android-offline-tts-apk.md`

## Global Constraints

- The APK must not request `android.permission.INTERNET`.
- The APK targets `arm64-v8a` and Android API 26+.
- The model source remains `3rd/tts-server/models/extracted`; Gradle packages only the 14 required files.
- The UI exposes only multiline text input, generate button, and status feedback.
- `SpeechSynthesizer(config, null)` must be used for both voice probing and synthesis so the SDK does not create default speaker output.
- Text is trimmed, blank text is rejected, and text longer than 2000 characters is rejected.
- Existing unrelated worktree changes must remain untouched.
- Success status displays the monotonic elapsed time spent inside SDK synthesis, formatted to two decimal places.

---

### Task 1: Add pure text/model contracts and tests first

**Files:**
- Create: `3rd/tts-server/android-tts/app/src/main/java/com/aasc/tts/TtsTextPolicy.kt`
- Create: `3rd/tts-server/android-tts/app/src/main/java/com/aasc/tts/TtsModelFiles.kt`
- Test: `3rd/tts-server/android-tts/app/src/test/java/com/aasc/tts/TtsTextPolicyTest.kt`
- Test: `3rd/tts-server/android-tts/app/src/test/java/com/aasc/tts/TtsModelFilesTest.kt`

**Interfaces:**
- `TtsTextPolicy.normalize(rawText: String): String` returns trimmed valid text or throws `IllegalArgumentException`.
- `TtsModelFiles.FILE_NAMES` exposes the exact 14 required asset names.
- `TtsModelFiles.isComplete(modelDir: File): Boolean` checks regular files.

- [x] **Step 1: Write failing tests**

```kotlin
@Test fun normalizeTrimsText() = assertEquals("你好", TtsTextPolicy.normalize("  你好  "))
@Test(expected = IllegalArgumentException::class)
fun normalizeRejectsBlankText() { TtsTextPolicy.normalize(" \n ") }
@Test fun normalizeAcceptsTwoThousandCharacters() = assertEquals(2000, TtsTextPolicy.normalize("字".repeat(2000)).length)
@Test(expected = IllegalArgumentException::class)
fun normalizeRejectsTwoThousandAndOneCharacters() { TtsTextPolicy.normalize("字".repeat(2001)) }
@Test fun modelListContainsRequiredMainFiles() {
    assertTrue(TtsModelFiles.FILE_NAMES.contains("2052.INI"))
    assertTrue(TtsModelFiles.FILE_NAMES.contains("MSTTSLocZhCN.dat"))
    assertEquals(14, TtsModelFiles.FILE_NAMES.size)
}
```

- [x] **Step 2: Run the tests and verify the expected missing-symbol failure**

Run: `src/apps/android-display/gradlew -p 3rd/tts-server/android-tts testDebugUnitTest --tests 'com.aasc.tts.*'`

Expected: FAIL because the new classes and Android project are not implemented yet.

- [x] **Step 3: Implement the minimal pure contracts**

```kotlin
object TtsTextPolicy {
    const val MAX_LENGTH = 2000
    fun normalize(rawText: String): String {
        val text = rawText.trim()
        require(text.isNotEmpty()) { "请输入要生成的文本" }
        require(text.length <= MAX_LENGTH) { "文本不能超过 2000 个字符" }
        return text
    }
}
```

- [x] **Step 4: Run the focused tests and verify green**

Run: `src/apps/android-display/gradlew -p 3rd/tts-server/android-tts testDebugUnitTest --tests 'com.aasc.tts.*'`

Expected: all focused tests pass.

### Task 2: Scaffold the standalone Android project and bundle assets

**Files:**
- Create: `3rd/tts-server/android-tts/settings.gradle.kts`
- Create: `3rd/tts-server/android-tts/build.gradle.kts`
- Create: `3rd/tts-server/android-tts/gradle.properties`
- Create: `3rd/tts-server/android-tts/app/build.gradle.kts`
- Create: `3rd/tts-server/android-tts/app/src/main/AndroidManifest.xml`
- Modify: `3rd/tts-server/android-tts/app/src/main/java/com/aasc/tts/TtsModelFiles.kt`

**Interfaces:**
- Gradle task `prepareBundledTtsModel` copies only `TtsModelFiles.FILE_NAMES` from `../models/extracted` into generated `assets/tts`.
- `assembleDebug` packages the generated assets and the existing Embedded Speech AAR.

- [x] **Step 1: Add project configuration and the model copy task**
- [x] **Step 2: Run the debug build to verify the project compiles before engine/UI code**

Run: `src/apps/android-display/gradlew -p 3rd/tts-server/android-tts :app:assembleDebug`

Expected: build succeeds after the minimal application class is present, or reports only the intentionally missing activity until Task 4.

- [x] **Step 3: Verify manifest and asset packaging**

Run: `unzip -l 3rd/tts-server/android-tts/app/build/outputs/apk/debug/app-debug.apk | rg 'assets/tts/(2052.INI|MSTTSLocZhCN.dat)'` and `unzip -p .../app-debug.apk AndroidManifest.xml | strings | rg INTERNET`.

Expected: both model assets are present and no INTERNET permission string is present.

### Task 3: Implement model loading, offline synthesis, and audio playback

**Files:**
- Modify: `3rd/tts-server/android-tts/app/src/main/java/com/aasc/tts/TtsModelFiles.kt`
- Create: `3rd/tts-server/android-tts/app/src/main/java/com/aasc/tts/TtsEngine.kt`
- Create: `3rd/tts-server/android-tts/app/src/main/java/com/aasc/tts/AudioPlayer.kt`

**Interfaces:**
- `TtsModelFiles.ensureCopied(assetManager, modelDir)` atomically materializes all assets.
- `TtsEngine.load(modelDir)`, `synthesize(text)`, and `release()` manage the native SDK.
- `AudioPlayer.play(wavBytes, onComplete, onError)`, `stop()`, and `release()` manage one active playback.

- [x] **Step 1: Add model copy tests for incomplete-directory behavior**
- [x] **Step 2: Run the focused test and verify it fails before implementation**
- [x] **Step 3: Implement atomic asset copying and completeness checks**
- [x] **Step 4: Implement Embedded Speech initialization and Xiaoxiao voice selection with `SpeechSynthesizer(config, null)` for both probe and synthesis**
- [x] **Step 5: Return audio bytes plus monotonic synthesis duration from the engine**
- [x] **Step 6: Implement serialized WAV playback with MediaPlayer**
- [x] **Step 7: Run unit tests and compile the app**

Run: `src/apps/android-display/gradlew -p 3rd/tts-server/android-tts testDebugUnitTest :app:assembleDebug`

Expected: focused tests pass and the debug APK is produced.

### Task 4: Implement the minimal screen and lifecycle state machine

**Files:**
- Create: `3rd/tts-server/android-tts/app/src/main/res/layout/activity_main.xml`
- Create: `3rd/tts-server/android-tts/app/src/main/res/values/strings.xml`
- Create: `3rd/tts-server/android-tts/app/src/main/res/values/themes.xml`
- Create: `3rd/tts-server/android-tts/app/src/main/java/com/aasc/tts/MainActivity.kt`

**Interfaces:**
- `MainActivity` owns model-ready, generating, completed, and error UI states.
- Generate action uses `TtsTextPolicy.normalize` and never runs SDK work on the main thread.

- [x] **Step 1: Add the layout and string resources**
- [x] **Step 2: Implement asynchronous model loading and button state updates**
- [x] **Step 3: Implement validation, synthesis dispatch, duration formatting, playback callbacks, and cleanup**
- [x] **Step 4: Build the APK and inspect the manifest**

Run: `src/apps/android-display/gradlew -p 3rd/tts-server/android-tts testDebugUnitTest :app:assembleDebug`

Expected: all unit tests pass and `app-debug.apk` exists.

### Task 5: Register scripts and complete project documentation

**Files:**
- Modify: `3rd/tts-server/package.json`
- Modify: `3rd/tts-server/docs/design.md`
- Modify: `3rd/tts-server/docs/spec.md`
- Modify: `3rd/tts-server/docs/todo.md`
- Modify: `3rd/tts-server/docs/task/2026-08-25_独立Android离线TTS-APK.md`
- Modify: `3rd/tts-server/changelog.md`

- [x] **Step 1: Add `npm run build:android-tts` using the existing Gradle wrapper**
- [x] **Step 2: Add design/spec index links and mark the task complete**
- [x] **Step 3: Run the project-preferred build script**

Run: `npm run build:android-tts`

Expected: exit code 0 and `3rd/tts-server/android-tts/app/build/outputs/apk/debug/app-debug.apk` exists.

- [x] **Step 4: Run focused Android unit tests through the available wrapper**
- [x] **Step 5: Review `git diff --check` and preserve unrelated worktree changes**
