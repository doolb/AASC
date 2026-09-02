# Formal Android OCR and YOLO11n Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lazy RapidOCR and YOLO11n inference to the formal Android display APK, expose server-routed task calls to the display-side bridge, and keep a one-little-core default.

**Architecture:** Keep ASR/TTS untouched. Add a focused `com.aasc.display.vision` runtime with a bounded single-thread executor, shared image decoding/model-file checks, and two lazy ONNX Runtime engines. Extend `NativeBridge` with asynchronous/status methods, add server HTTP routes and `ocr`/`yolo` task modules that route through WebSocket to the display, and remove the manual `vision-test.html` page and DevTools hook.

**Tech Stack:** Kotlin, Android API 26–34, Gradle Kotlin DSL, ONNX Runtime Android 1.23.2, OpenCV 4.9.0, JUnit 4, existing `CpuCluster`/`CpuAffinity`, vanilla HTML/CSS/JavaScript, Python `unittest` for YOLO export selection.

**Spec:** `docs/design/android-native-ocr-yolo.md`, `docs/spec/android-native-ocr-yolo.md`, `docs/task/2026-09-02_正式APK接入OCR与YOLO11n.md`

## Global Constraints

- Formal APK remains `src/apps/android-display`, arm64-v8a, minSdk 26, targetSdk 34.
- Bundle only RapidOCR detector/classifier/recognizer/dictionary and `yolo11n.onnx`.
- Vision default is `CpuCluster.detect().policy(bigCoreCount=0, littleCoreCount=1)` with ORT intra/inter threads both 1.
- Do not modify ASR/TTS policy defaults, pools, or CPU configuration semantics.
- Use `const/let`, `async/await`, `try/catch`, Chinese detailed comments, and no large if/else chains in JavaScript.
- Use `apply_patch` for source/doc edits and never stage unrelated worktree files.
- Run the existing Gradle/npm scripts where available and verify before claiming completion.

---

### Task 1: Lock the model export and runtime contracts with failing tests

**Files:**
- Modify: `3rd/tts-server/scripts/test_export_yolo11_onnx.py`
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/VisionCpuPolicyTest.kt`
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/VisionImageCodecTest.kt`
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/VisionModelFilesTest.kt`

**Interfaces:**
- The export test will call `validate_sources(inputDir, tupleOf("yolo11n"))` and require only `yolo11n.pt`.
- The Kotlin tests will require `VisionCpuPolicy.defaultFor(topology)` to select one little CPU and `VisionImageCodec`/`VisionModelFiles` to expose the documented limits and completeness behavior.

- [x] **Step 1: Write the failing tests**

  Add a Python test that creates only `yolo11n.pt`, calls `validate_sources(directory, ("yolo11n",))`, and asserts the returned tuple contains only that file. Add Kotlin tests asserting the new production symbols and exact one-little-core policy, image limits, and one-file model completeness.

- [x] **Step 2: Run tests to verify they fail for the intended reason**

  Run `python3 -m unittest 3rd/tts-server/scripts/test_export_yolo11_onnx.py -v` and `./src/apps/android-display/gradlew -p src/apps/android-display :app:testDebugUnitTest --tests 'com.aasc.display.VisionCpuPolicyTest' --tests 'com.aasc.display.VisionImageCodecTest' --tests 'com.aasc.display.VisionModelFilesTest' --no-daemon --console=plain`.

  Expected: Python reports `validate_sources` does not accept the selected model tuple; Kotlin reports the new vision classes are unresolved.

- [x] **Step 3: Add only the minimum test-support contracts needed for compilation**

  Keep the tests expressing behavior rather than source text. Use a deterministic `CpuTopology(listOf(0L to 1000L, 1L to 1000L, 4L to 2000L, 5L to 2000L))` fixture and temporary directories for file checks.

- [x] **Step 4: Re-run and preserve the red result**

  Confirm the failure is caused by missing production behavior, not a malformed test, before writing production implementation.

### Task 2: Implement model selection, vision CPU policy, image decoding, and model files

**Files:**
- Modify: `3rd/tts-server/scripts/export-yolo11-onnx.py`
- Modify: `src/apps/android-display/app/build.gradle.kts`
- Modify: `src/apps/android-display/app/src/test/java/com/aasc/display/VisionCpuPolicyTest.kt`
- Modify: `src/apps/android-display/app/src/test/java/com/aasc/display/VisionImageCodecTest.kt`
- Modify: `src/apps/android-display/app/src/test/java/com/aasc/display/VisionModelFilesTest.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/VisionCpuPolicy.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/VisionImageCodec.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/VisionModelFiles.kt`

**Interfaces:**
- `VisionCpuPolicy.defaultFor(topology: CpuTopology): CpuPolicy`.
- `VisionImageCodec.MAX_BODY_BYTES`, `MAX_PIXELS`, and `decode(encoded: String): Bitmap`.
- `VisionModelFiles.ensureRapidOcrCopied(assetManager, targetDir)` and `ensureYoloCopied(assetManager, targetDir)`.
- Export parser accepts `--models yolo11n`; no argument keeps the five-model test APK behavior.

- [x] **Step 1: Implement the selected-model export option**

  Add an argparse `--models` list constrained to `MODEL_NAMES`, defaulting to all five. Pass the selected names to `validate_sources` and export loop. Preserve exact missing-file errors and existing reuse behavior.

- [x] **Step 2: Implement the formal Gradle generated assets**

  Add a `Copy` task for the four RapidOCR assets under `vision/rapidocr`, an `Exec` task invoking the export script with `--models yolo11n`, and make `preBuild` depend on both. Add ORT, OpenCV, and ExifInterface dependencies and keep generated assets in `main` sourceSet.

- [x] **Step 3: Implement and test the one-little-core policy and codecs**

  Build the policy from existing `CpuCluster`, apply `CpuAffinity.applyCurrentThread`, and report one ORT thread. Decode both raw Base64 and data URLs; validate bytes before allocation and decoded dimensions after allocation; reject unsupported types and all documented limits.

- [x] **Step 4: Implement atomic model copies**

  Copy required assets through `.tmp`, validate non-empty files, rename them, and re-check the complete set. Keep RapidOCR’s four-file list separate from YOLO11n’s one-file list.

- [x] **Step 5: Run the focused green tests**

  Run the two commands from Task 1 plus `python3 -m unittest 3rd/tts-server/scripts/test_export_yolo11_onnx.py -v`. Expected: all focused tests pass; export tests still verify default five-model missing-file behavior.

### Task 3: Port and test the RapidOCR inference core

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/ocr/OcrModels.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/ocr/OcrTensorPreprocessor.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/ocr/RapidOcrOrtUtils.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/ocr/DbPostProcessor.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/ocr/PerspectiveCropper.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/ocr/OrientationClassifier.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/ocr/RecognitionDecoder.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/ocr/RapidOcrEngine.kt`
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/OcrGeometryTest.kt`
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/OcrTensorPreprocessorTest.kt`
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/CtcDecoderTest.kt`

**Interfaces:**
- `RapidOcrEngine.load(modelDir: File, policy: CpuPolicy)`.
- `RapidOcrEngine.recognize(bitmap: Bitmap, policy: CpuPolicy): OcrResult`.
- `OcrResult` carries text boxes, timing, and affinity status.

- [x] **Step 1: Port pure OCR tests first**

  Adapt the existing RapidOCR geometry, tensor preprocessor, CTC decoder, image policy, and model-file tests into the formal package, keeping assertions on real outputs. Run the focused formal test names and confirm unresolved production symbols or expected red failures.

- [x] **Step 2: Port the minimum OCR data and preprocessing types**

  Add the model/result types, OpenCV crop/resize helpers, tensor creation/read helpers, DB postprocessor, perspective cropper, orientation classifier, and recognition decoder under `com.aasc.display.vision.ocr`.

- [x] **Step 3: Implement lazy RapidOCR session loading**

  Create detector/classifier/recognizer sessions with the vision policy, reload only when policy changes, use `setIntraOpNumThreads(1)`, `setInterOpNumThreads(1)`, and release sessions/options on failure. Keep the existing test APK algorithm and thresholds.

- [x] **Step 4: Implement the synchronized recognize path**

  Run detection, crop/classify/recognize each box, assemble the text and timing result, and avoid recycling the caller-owned bitmap inside the engine. The runtime owns recycling.

- [x] **Step 5: Run OCR tests and a compile check**

  Run `./src/apps/android-display/gradlew -p src/apps/android-display :app:testDebugUnitTest --tests 'com.aasc.display.*Ocr*' --tests 'com.aasc.display.*Decoder*' --no-daemon --console=plain` and fix only implementation failures until green.

### Task 4: Port and test YOLO11n inference core

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/yolo/YoloModel.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/yolo/YoloImagePolicy.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/yolo/YoloOrtUtils.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/yolo/YoloPreprocessor.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/yolo/YoloPostprocessor.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/yolo/YoloDetector.kt`
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/YoloPreprocessorTest.kt`
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/YoloPostprocessorTest.kt`

**Interfaces:**
- `Yolo11nDetector.load(modelFile: File, policy: CpuPolicy): Long`.
- `Yolo11nDetector.detect(bitmap: Bitmap, policy: CpuPolicy): YoloResult`.
- `YoloResult` contains model name, detections, stage timing, and affinity status.

- [x] **Step 1: Port YOLO pure-core tests first and observe red**

  Adapt image policy, letterbox, NCHW, output-layout, confidence, and NMS tests from the independent APK. Run them before adding formal production classes.

- [x] **Step 2: Implement YOLO11n model and preprocessing**

  Keep a single fixed model enum/value, 640x640 RGB NCHW float input, 0–1 normalization, and the existing letterbox transform.

- [x] **Step 3: Implement postprocessing and detector session lifecycle**

  Decode supported output layouts, apply confidence 0.25 and IoU 0.45 NMS, create one ORT session with one intra/inter thread, and release resources on replacement/failure.

- [x] **Step 4: Run focused YOLO tests and compile**

  Run `./src/apps/android-display/gradlew -p src/apps/android-display :app:testDebugUnitTest --tests 'com.aasc.display.*Yolo*' --no-daemon --console=plain` and then the complete formal JVM test task.

### Task 5: Add the shared runtime and NativeBridge asynchronous protocol

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/vision/VisionRuntime.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/VisionProtocolTest.kt`

**Interfaces:**
- `VisionRuntime.status(): JSONObject`.
- `VisionRuntime.submitOcr(requestId: String, encodedImage: String, callback: (JSONObject) -> Unit): JSONObject`.
- `VisionRuntime.submitYolo11n(requestId: String, encodedImage: String, callback: (JSONObject) -> Unit): JSONObject`.
- `NativeBridge.visionStatus(): String`, `ocrRecognizeAsync(...)`, and `yolo11nDetectAsync(...)`.

- [x] **Step 1: Write protocol tests and observe red**

  Assert accepted responses, busy responses, `requestId`, success/error shape, timing fields, and one-result semantics for the pure result-building helpers.

- [x] **Step 2: Implement the bounded single-thread runtime**

  Use a one-worker executor with one waiting slot, lazily ensure the corresponding model, decode input inside the worker, call the correct engine, catch expected exceptions, and recycle Bitmap in `finally`.

- [x] **Step 3: Add bridge methods and timeout callbacks**

  Add `VISION_TIMEOUT_SECONDS=120L`, submit to runtime, atomically guard callback delivery, cancel waiting futures on timeout, and use `mainHandler.post` for safe `evaluateJavascript` calls. Do not touch ASR/TTS executors.

- [x] **Step 4: Add status JSON**

  Return vision policy, ORT thread counts, model copy/session state, queue state, and affinity fallback without forcing model load.

- [x] **Step 5: Run protocol and complete JVM tests**

  Run `./src/apps/android-display/gradlew -p src/apps/android-display :app:testDebugUnitTest --no-daemon --console=plain`; expected existing ASR/TTS tests and all vision tests pass.

### Task 6: Add server-routed vision tasks and capability declarations

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/apps/server/modules/task-engine/task-manager.js`
- Modify: `src/apps/server/modules/task-engine/builtin-tasks/registry.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Create: `src/apps/server/modules/task-engine/builtin-tasks/ocr.js`
- Create: `src/apps/server/modules/task-engine/builtin-tasks/yolo.js`
- Create: `src/apps/server/modules/task-engine/builtin-tasks/vision-task-client.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`
- Delete: `src/apps/web-mediacenter/ui/public/vision-test.html`
- Delete: `src/apps/web-mediacenter/ui/public/js/vision-test.js`
- Delete: `src/apps/web-mediacenter/ui/public/js/vision-test.test.js`
- Delete: `src/apps/web-mediacenter/ui/public/css/vision-test.css`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/ServerConfig.kt`

**Interfaces:**
- `display.html` declares `ocrAvailable` and `yolo11nAvailable` based on bridge method presence.
- Server routes use `visionOcr`/`visionYolo11n` WebSocket requests and matching result messages; tasks use a default local `serverUrl`.

- [x] **Step 1: Add task/route contract test expectations**

  Add Node tests asserting both built-in tasks expose `serverUrl`, `targetDisplay`, and image input behavior; server routes expose request/result message types; display.html forwards native vision results and no manual vision page is required.

- [x] **Step 2: Implement page capability fields**

  Extend the existing capability object and base capability object without changing voice capability logic. Keep async capability detection non-blocking.

- [x] **Step 3: Implement server routes, task modules, and task-panel forms**

  Add multipart/JSON image validation, request ID map, two server-side HTTP routes, two built-in task definitions with default local URL, and task-panel upload/display selection. Use `const/let`, `async/await`, and try/catch.

- [x] **Step 4: Run JS checks**

  Run the vision task/route contract tests and `git diff --check`.

### Task 7: Build, device-test, document, and commit

**Files:**
- Modify: `docs/design.md`
- Modify: `docs/spec.md`
- Modify: `docs/usage.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Modify: `docs/task/2026-09-02_正式APK接入OCR与YOLO11n.md`

- [x] **Step 1: Build through the existing npm script**

  Run `npm run build:apk`. Inspect APK assets and verify RapidOCR has four required files and YOLO has only `yolo11n.onnx`; record any ORT duplicate-native resolution in the task/changelog.

- [x] **Step 2: Install and test on the known arm64 Android device**

  Install the generated debug APK with the existing deployment path, connect `/display`, submit OCR/YOLO tasks from the control task panel, and capture route results plus display-side timing/affinity. Verify the result says one little core or explicitly reports fallback.

- [x] **Step 3: Run regression verification**

  Run the complete formal JVM test task, Python export tests, relevant Node tests, `node --check`, and `git diff --check`. Do not report success without command output showing pass/zero errors.

- [x] **Step 4: Finish documentation and remove the todo entry**

  Record exact changed files, model assets, test commands/results, device result, and known limitations in changelog/task. Remove the completed active task from `docs/todo.md`; leave only unrelated pending tasks.

- [x] **Step 5: Stage only the feature files and commit**

  Review `git status --short`, stage the explicit feature paths only, and commit with `feat: integrate OCR and YOLO11n into display APK`. Keep all pre-existing logs, generated `.cxx`, temporary result directories, and other unrelated user files unstaged.
