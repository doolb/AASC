# Android YOLO11 五模型速度测试 APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent arm64 Android APK that converts the five local YOLO11 `.pt` weights to ONNX, serves HTTP/web image detection, and compares model speed on the phone.

**Architecture:** Add a standalone `android-yolo` Kotlin application patterned after `android-rapidocr`. Gradle invokes a Python exporter to generate build-only ONNX assets from `/home/as` (or `YOLO11_MODEL_DIR`), while the app loads one ONNX Runtime session at a time. A single inference executor serializes detection and benchmark requests, applies the selected CPU affinity, and exposes both JSON endpoints and an embedded web page.

**Tech Stack:** Kotlin, Android Gradle Plugin, ONNX Runtime Android 1.22.0, Android Bitmap APIs, JNI/C++ `sched_setaffinity`, Python Ultralytics export, JUnit 4.

**Spec:** `3rd/tts-server/docs/spec/android-yolo-apk.md`

## Global Constraints

- Android minimum API is 26 and target API is 34.
- APK ABI is `arm64-v8a` only.
- Input models are `/home/as/yolo11n.pt`, `/home/as/yolo11s.pt`, `/home/as/yolo11m.pt`, `/home/as/yolo11l.pt`, `/home/as/yolo11x.pt`, overridable with `YOLO11_MODEL_DIR`.
- ONNX export uses static `640x640` input and CPU export; `.pt` and generated ONNX files are not committed as source assets.
- The app loads one model session at a time and benchmark execution is serial.
- HTTP body limit is 20 MiB and decoded pixel limit is `12 * 1024 * 1024`.
- Benchmark defaults are `warmup=2` and `runs=10`; accepted ranges are warmup 0..10 and runs 1..50.
- CPU mode is AUTO/BIG/LITTLE and affinity failure falls back without failing inference.
- Every changed Kotlin/JavaScript/Python source uses `const`/`let` where applicable, `async/await` in browser code, `try/catch` around fallible operations, and Chinese detailed comments.

---

### Task 1: Add model exporter and Android project skeleton

**Files:**
- Create: `3rd/tts-server/scripts/export-yolo11-onnx.py`
- Create: `3rd/tts-server/android-yolo/settings.gradle.kts`
- Create: `3rd/tts-server/android-yolo/build.gradle.kts`
- Create: `3rd/tts-server/android-yolo/gradle.properties`
- Create: `3rd/tts-server/android-yolo/app/build.gradle.kts`
- Create: `3rd/tts-server/android-yolo/app/src/main/AndroidManifest.xml`
- Create: `3rd/tts-server/android-yolo/app/src/main/res/layout/activity_main.xml`
- Create: `3rd/tts-server/android-yolo/app/src/main/res/values/strings.xml`
- Create: `3rd/tts-server/android-yolo/app/src/main/res/values/themes.xml`
- Modify: `3rd/tts-server/package.json`

**Interfaces:**
- Consumes: five `.pt` files from `YOLO11_MODEL_DIR` or `/home/as`.
- Produces: `build/generated/assets/yolo11/yolo11{n,s,m,l,x}.onnx` and `build:android-yolo` npm script.

- [ ] **Step 1: Write the failing exporter test**

Add a Python test that invokes the exporter with a missing `yolo11n.pt` and asserts a non-zero exit plus the missing filename in stderr.

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest 3rd/tts-server/scripts/test_export_yolo11_onnx.py -v`

Expected: FAIL because the exporter and test file do not exist yet.

- [ ] **Step 3: Write minimal exporter and Gradle configuration**

Implement argument parsing for `--input-dir`, `--output-dir`, and optional `--python`; check all five source files before importing Ultralytics; call `YOLO(path).export(format="onnx", imgsz=640, dynamic=False, simplify=True, device="cpu")`; copy the returned ONNX file to the requested output and remove incomplete temporary outputs. Configure Gradle `prepareBundledYoloModels` as a preBuild dependency and add `build:android-yolo`.

- [ ] **Step 4: Run the exporter test to verify it passes**

Run: `python3 -m unittest 3rd/tts-server/scripts/test_export_yolo11_onnx.py -v`

Expected: PASS for missing-file validation and argument handling.

- [ ] **Step 5: Commit**

Run: `git add 3rd/tts-server/scripts 3rd/tts-server/android-yolo 3rd/tts-server/package.json && git commit -m "feat: scaffold Android YOLO11 test APK"`

### Task 2: Implement CPU mode, model files, preprocessing, and postprocessing with tests

**Files:**
- Create: `3rd/tts-server/android-yolo/app/src/main/cpp/CMakeLists.txt`
- Create: `3rd/tts-server/android-yolo/app/src/main/cpp/cpu_affinity.cpp`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/CpuMode.kt`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/CpuAffinity.kt`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/YoloModel.kt`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/YoloModelFiles.kt`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/YoloImagePolicy.kt`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/YoloPreprocessor.kt`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/YoloPostprocessor.kt`
- Test: `3rd/tts-server/android-yolo/app/src/test/java/com/aasc/yolo/CpuModeTest.kt`
- Test: `3rd/tts-server/android-yolo/app/src/test/java/com/aasc/yolo/YoloModelFilesTest.kt`
- Test: `3rd/tts-server/android-yolo/app/src/test/java/com/aasc/yolo/YoloPreprocessorTest.kt`
- Test: `3rd/tts-server/android-yolo/app/src/test/java/com/aasc/yolo/YoloPostprocessorTest.kt`

**Interfaces:**
- Consumes: generated ONNX asset names and Android `Bitmap` pixels.
- Produces: `YoloPreprocessor.prepare(Bitmap): PreparedInput`, `YoloPostprocessor.decode(LongArray, FloatArray, PreparedInput, Float, Float): List<YoloDetection>`, and `CpuAffinity.apply(CpuMode): String`.

- [ ] **Step 1: Write failing unit tests**

Cover exact five-model enumeration, unknown CPU value fallback, 640 letterbox scale/padding, both output layouts, confidence filtering, same-class NMS, and cross-class preservation.

- [ ] **Step 2: Run tests to verify they fail**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-yolo :app:testDebugUnitTest --tests 'com.aasc.yolo.*'`

Expected: FAIL because the production classes are not defined.

- [ ] **Step 3: Implement minimal model/image/tensor logic**

Implement safe asset copying, bitmap pixel extraction, coordinate mapping, layout detection, class-score maximum, class-aware greedy NMS, and native affinity wrapper by adapting the proven RapidOCR CPU affinity boundary to package `com.aasc.yolo`.

- [ ] **Step 4: Run tests to verify they pass**

Run the same Gradle test command and expect all new tests PASS.

- [ ] **Step 5: Commit**

Run: `git add 3rd/tts-server/android-yolo/app/src/main && git commit -m "feat: add YOLO11 preprocessing and CPU affinity"`

### Task 3: Implement ONNX detector and benchmark statistics with tests

**Files:**
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/YoloModels.kt`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/YoloDetector.kt`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/YoloBenchmark.kt`
- Test: `3rd/tts-server/android-yolo/app/src/test/java/com/aasc/yolo/YoloBenchmarkTest.kt`
- Test: `3rd/tts-server/android-yolo/app/src/test/java/com/aasc/yolo/YoloDetectorTest.kt`

**Interfaces:**
- Consumes: `YoloModelFiles`, `YoloPreprocessor`, `YoloPostprocessor`, `CpuMode`.
- Produces: `YoloDetector.load(YoloModel): Long`, `YoloDetector.detectLoaded(Bitmap, CpuMode): YoloResult`, `YoloBenchmark.run(Bitmap, List<YoloModel>, Int, Int, CpuMode): YoloBenchmarkResult`.

- [ ] **Step 1: Write failing benchmark tests**

Assert average, P50, P95 and FPS calculations from a fixed timing list; assert invalid warmup/runs are rejected and detector closes the old session when changing models.

- [ ] **Step 2: Run tests to verify they fail**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-yolo :app:testDebugUnitTest --tests 'com.aasc.yolo.YoloBenchmarkTest' --tests 'com.aasc.yolo.YoloDetectorTest'`

Expected: FAIL because benchmark and detector classes are absent.

- [ ] **Step 3: Implement detector and benchmark**

Create one ORT environment and one active session, close the active session before switching, create `[1,3,640,640]` tensors, measure each stage with a monotonic clock, apply affinity only in the inference executor, run warmups without recording, and calculate average/P50/P95/FPS from measured totals.

- [ ] **Step 4: Run tests to verify they pass**

Run the same command and expect all benchmark/detector tests PASS.

- [ ] **Step 5: Commit**

Run: `git add 3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo 3rd/tts-server/android-yolo/app/src/test && git commit -m "feat: add YOLO11 inference benchmark"`

### Task 4: Implement HTTP protocol, JSON, embedded webpage, and Activity

**Files:**
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/YoloHttpJson.kt`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/YoloHttpServer.kt`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/YoloWebPage.kt`
- Create: `3rd/tts-server/android-yolo/app/src/main/java/com/aasc/yolo/MainActivity.kt`
- Modify: `3rd/tts-server/android-yolo/app/src/main/res/layout/activity_main.xml`
- Modify: `3rd/tts-server/android-yolo/app/src/main/res/values/strings.xml`
- Test: `3rd/tts-server/android-yolo/app/src/test/java/com/aasc/yolo/YoloHttpJsonTest.kt`
- Test: `3rd/tts-server/android-yolo/app/src/test/java/com/aasc/yolo/YoloHttpServerTest.kt`

**Interfaces:**
- Consumes: detector, benchmark, CPU provider, decoded request image.
- Produces: GET `/`, `/health`, `/api/models`; POST `/api/yolo?model=...`; POST `/api/benchmark?models=all&warmup=2&runs=10`.

- [ ] **Step 1: Write failing HTTP/JSON tests**

Assert HTML contains the upload, model selector, detect and benchmark controls; assert JSON escapes control characters; assert model list, invalid method, invalid model and busy responses use the documented status codes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-yolo :app:testDebugUnitTest --tests 'com.aasc.yolo.YoloHttp*Test'`

Expected: FAIL because HTTP classes and routes do not exist.

- [ ] **Step 3: Implement minimal HTTP/web/UI flow**

Implement bounded request parsing and content validation, serialized inference/benchmark execution with 60/300 second timeouts, consistent JSON errors, native CPU mode persistence, model-ready gating, local address display, and webpage fetch/Canvas rendering using browser `async/await` and try/catch.

- [ ] **Step 4: Run tests to verify they pass**

Run the same Gradle command and expect all HTTP/JSON tests PASS.

- [ ] **Step 5: Commit**

Run: `git add 3rd/tts-server/android-yolo/app/src/main && git commit -m "feat: add YOLO11 HTTP and web test interface"`

### Task 5: Build with the five real weights and verify the APK

**Files:**
- Modify: `3rd/tts-server/docs/design.md`
- Modify: `3rd/tts-server/docs/spec.md`
- Modify: `3rd/tts-server/docs/todo.md`
- Modify: `docs/design.md`
- Modify: `docs/spec.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Modify: `3rd/tts-server/docs/design/android-yolo-apk.md`
- Modify: `3rd/tts-server/docs/spec/android-yolo-apk.md`
- Modify: `3rd/tts-server/docs/task/2026-09-01_独立Android-YOLO11五模型速度测试APK.md`

**Interfaces:**
- Consumes: complete Android module and five `.pt` files.
- Produces: debug APK, test evidence, synchronized documentation, and completed task ledger.

- [ ] **Step 1: Run all JVM tests**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-yolo :app:testDebugUnitTest`

Expected: exit 0 with zero failed tests.

- [ ] **Step 2: Export real models and build APK**

Run: `npm --prefix 3rd/tts-server run build:android-yolo`

Expected: five ONNX files appear under `android-yolo/app/build/generated/assets/yolo11` and APK appears at `android-yolo/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 3: Inspect APK contents**

Run: `unzip -l 3rd/tts-server/android-yolo/app/build/outputs/apk/debug/app-debug.apk | rg 'yolo11|lib/arm64-v8a'`

Expected: five `assets/yolo11/yolo11*.onnx` entries and the arm64 CPU affinity library are present.

- [ ] **Step 4: Install and exercise device endpoints**

Run the existing adb device deployment flow, then query `/health`, `/api/models`, upload one fixed image to each model, and call the all-model benchmark. Record actual model load, average, P50, P95 and FPS results; verify AUTO/BIG/LITTLE persistence and safe fallback.

- [ ] **Step 5: Update docs and finish verification**

Add actual command output and device observations to the task/spec/design/changelog docs, remove the completed item from both todo files, run `git diff --check`, review `git status`, and commit only YOLO files plus synchronized documentation.
