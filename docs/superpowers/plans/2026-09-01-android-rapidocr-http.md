# Android RapidOCR HTTP Test APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `3rd/tts-server` 下新增一个 arm64 Android RapidOCR 测试 APK，通过本地 HTTP 接口和内置网页上传图片并返回 OCR 文本、文字框、置信度和耗时。

**Architecture:** 复用现有 `android-asr` 的独立 Android 工程和极简 Socket HTTP 服务模式，APK 启动时把四个 RapidOCR ONNX/字典资源复制到私有目录。Kotlin 负责 HTTP 生命周期、图片解码、网页和 JSON，ONNX Runtime 负责三个模型推理，OpenCV 负责 DB 检测后处理、透视裁剪和文字框几何计算。

**Tech Stack:** Kotlin、Android Gradle Plugin 9.3.1、Gradle wrapper from `src/apps/android-display`、Android API 26–34、ONNX Runtime Android 1.22.0、OpenCV Android 4.9.0、JUnit 4、PP-OCRv6 small ONNX model set.

**Spec:** `3rd/tts-server/docs/spec/android-rapidocr-apk.md`

## Global Constraints

- 工作目录固定为 `/mnt/AASC` 的现有 `master`，不创建或切换 worktree。
- 保留工作区已有改动，不使用 `git reset --hard`、`git checkout --` 或大范围清理命令。
- APK namespace/applicationId 使用 `com.aasc.rapidocr`，最低 Android API 26，只打包 `arm64-v8a`。
- HTTP 服务默认监听 `0.0.0.0:18080`，只用于受信任局域网测试；APK 不主动访问外网。
- 请求体最多 20 MiB，图片像素总量受限；单次 OCR 最长等待 60 秒，推理期间只允许一个请求。
- 模型固定为 `PP-OCRv6_det_small.onnx`、`ch_ppocr_mobile_v2.0_cls_mobile.onnx`、`PP-OCRv6_rec_small.onnx`、`ppocrv6_dict.txt`。
- 生产代码中的 Kotlin/Java 异步工作必须离开主线程并使用 `try-catch`；新增注释使用中文并说明资源生命周期和失败原因。
- 每个新增行为先写一个会失败的 JVM 单元测试并执行确认失败，再实现最小代码，最后执行定向测试和完整 APK 构建。
- 完成实现后从 `docs/todo.md` 和 `3rd/tts-server/docs/todo.md` 删除进行中条目，并更新 design、spec、task、changelog、readme/usage 入口。

## File Map

### New files

- `3rd/tts-server/android-rapidocr/settings.gradle.kts`：独立工程和仓库配置。
- `3rd/tts-server/android-rapidocr/build.gradle.kts`：Android Gradle plugin 版本声明。
- `3rd/tts-server/android-rapidocr/gradle.properties`：AndroidX 和 Gradle JVM 设置。
- `3rd/tts-server/android-rapidocr/app/build.gradle.kts`：APK、模型 assets、ABI、ONNX Runtime/OpenCV 依赖。
- `3rd/tts-server/android-rapidocr/app/src/main/AndroidManifest.xml`：主 Activity 和 `INTERNET` 权限。
- `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/*.kt`：模型文件、图像策略、OCR 引擎、HTTP 服务、JSON、网页和 Activity。
- `3rd/tts-server/android-rapidocr/app/src/main/res/layout/activity_main.xml`：模型状态、端口和 HTTP 控制页面。
- `3rd/tts-server/android-rapidocr/app/src/main/res/values/strings.xml`、`themes.xml`：界面文案和主题。
- `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/*.kt`：策略、解码、HTTP 和模型文件 JVM 单元测试。
- `res/models/rapidocr/PP-OCRv6_det_small.onnx`：RapidOCR PP-OCRv6 small 检测模型。
- `res/models/rapidocr/ch_ppocr_mobile_v2.0_cls_mobile.onnx`：RapidOCR 方向分类模型。
- `res/models/rapidocr/PP-OCRv6_rec_small.onnx`：RapidOCR PP-OCRv6 small 识别模型。
- `res/models/rapidocr/ppocrv6_dict.txt`：PP-OCRv6 字典。
- `docs/superpowers/plans/2026-09-01-android-rapidocr-http.md`：本实现计划。

### Modified files

- `3rd/tts-server/package.json`：新增 `build:android-rapidocr`。
- `3rd/tts-server/readme.md`：增加构建命令、APK 位置和 HTTP/curl 示例。
- `3rd/tts-server/docs/design.md`、`docs/spec.md`：增加新模块索引。
- `3rd/tts-server/docs/todo.md`：实现完成后删除进行中条目。
- `3rd/tts-server/changelog.md`：记录完成日期、文件和验证结果。
- `docs/design.md`、`docs/spec.md`、`docs/todo.md`、`changelog.md`：同步根项目索引和完成记录。

---

### Task 1: Scaffold the Android project and bundle the fixed OCR model set

**Files:**
- Create: `3rd/tts-server/android-rapidocr/settings.gradle.kts`
- Create: `3rd/tts-server/android-rapidocr/build.gradle.kts`
- Create: `3rd/tts-server/android-rapidocr/gradle.properties`
- Create: `3rd/tts-server/android-rapidocr/app/build.gradle.kts`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/AndroidManifest.xml`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/res/values/strings.xml`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/res/values/themes.xml`
- Create: `res/models/rapidocr/PP-OCRv6_det_small.onnx`
- Create: `res/models/rapidocr/ch_ppocr_mobile_v2.0_cls_mobile.onnx`
- Create: `res/models/rapidocr/PP-OCRv6_rec_small.onnx`
- Create: `res/models/rapidocr/ppocrv6_dict.txt`
- Modify: `3rd/tts-server/package.json`

**Interfaces:**
- Produces Gradle task `:app:assembleDebug` and npm command `npm --prefix 3rd/tts-server run build:android-rapidocr`.
- Produces generated assets at `app/build/generated/assets/rapidocr` with exactly the four fixed files.

- [ ] **Step 1: Add the build-only project skeleton**

  Configure `com.android.application` version `9.3.1`, `compileSdk = 34`, `minSdk = 26`, `targetSdk = 34`, `namespace/applicationId = "com.aasc.rapidocr"`, and `abiFilters += "arm64-v8a"`. Add `androidx.core:core-ktx:1.12.0`, `androidx.appcompat:appcompat:1.6.1`, `com.microsoft.onnxruntime:onnxruntime-android:1.22.0`, `org.opencv:opencv:4.9.0`, `androidx.exifinterface:exifinterface:1.3.7`, and JUnit 4.13.2. Add a `Copy` task that copies the four files from `../../../res/models/rapidocr` into generated `assets/rapidocr` and make `preBuild` depend on it.

- [ ] **Step 2: Acquire the four pinned RapidOCR v3.9.2 resources**

  Download the exact files from the RapidAI ModelScope URLs recorded in the design doc's source notes, then verify these SHA-256 values before keeping them:

  ```text
  PP-OCRv6_det_small.onnx                 090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f
  ch_ppocr_mobile_v2.0_cls_mobile.onnx   e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c
  PP-OCRv6_rec_small.onnx                 6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884
  ppocrv6_dict.txt                         b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d
  ```

  Keep the files under `res/models/rapidocr`; do not duplicate them under `android-rapidocr/src/main/assets`.

- [ ] **Step 3: Add the npm build entry**

  Add:

  ```json
  "build:android-rapidocr": "../../src/apps/android-display/gradlew -p android-rapidocr :app:assembleDebug"
  ```

- [ ] **Step 4: Run the build skeleton check**

  Run: `npm --prefix 3rd/tts-server run build:android-rapidocr`

  Expected: the command reaches Android compilation, generates all four files under `app/build/generated/assets/rapidocr`, and only fails because the launcher Activity has not been added yet. If Gradle fails before compilation due to dependency or settings errors, fix the project skeleton before proceeding.

- [ ] **Step 5: Commit only new scaffold/model files if they are isolated**

  Run:

  ```bash
  git add 3rd/tts-server/android-rapidocr res/models/rapidocr 3rd/tts-server/package.json
  git commit -m "feat: scaffold RapidOCR Android test APK"
  ```

  Do not stage unrelated pre-existing changes in shared files.

### Task 2: Define failing tests for model files, image input, and JSON contracts

**Files:**
- Create: `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/RapidOcrModelFilesTest.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/OcrImagePolicyTest.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/OcrHttpJsonTest.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/OcrModels.kt`

**Interfaces:**
- `RapidOcrModelFiles.FILE_NAMES: List<String>` contains exactly the four resource names.
- `OcrImagePolicy.normalizeContentType(value: String?): String?` returns the lower-case media type before `;` or null.
- `OcrImagePolicy.validateContentType(value: String?)` throws `IllegalArgumentException` for unsupported types.
- `OcrHttpJson.success(result: OcrResult): String` and `OcrHttpJson.error(message: String): String` return valid JSON strings.
- `OcrPoint(x: Float, y: Float)`, `OcrBox(text: String, score: Float, points: List<OcrPoint>)`, and `OcrResult(text: String, elapsedMs: Long, imageWidth: Int, imageHeight: Int, boxes: List<OcrBox>)` are defined in `OcrModels.kt`.

- [ ] **Step 1: Write tests that describe the missing contracts**

  Cover exactly these behaviors:

  ```kotlin
  @Test fun modelListContainsFourPinnedFiles()
  @Test fun incompleteDirectoryIsNotReady()
  @Test fun contentTypeParametersAreAccepted()
  @Test(expected = IllegalArgumentException::class)
  fun audioContentTypeIsRejected()
  @Test fun successJsonContainsImageSizeBoxesAndElapsedTime()
  @Test fun jsonEscapesQuotesNewlinesAndBackslashes()
  ```

- [ ] **Step 2: Run the tests and confirm the expected RED state**

  Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-rapidocr :app:testDebugUnitTest --tests 'com.aasc.rapidocr.*'`

  Expected: FAIL because the model policy, result data classes, and JSON serializer are not implemented. A dependency resolution error is not an acceptable RED result.

### Task 3: Implement model file management, image validation, and JSON serialization

**Files:**
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/RapidOcrModelFiles.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/OcrImagePolicy.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/OcrHttpJson.kt`
- Modify: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/OcrModels.kt`
- Test: `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/RapidOcrModelFilesTest.kt`
- Test: `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/OcrImagePolicyTest.kt`
- Test: `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/OcrHttpJsonTest.kt`

**Interfaces:**
- `RapidOcrModelFiles.isComplete(modelDir: File): Boolean` checks directory, all four regular files, and non-zero length.
- `RapidOcrModelFiles.ensureCopied(assetManager: AssetManager, modelDir: File)` copies `assets/rapidocr/*` through sibling `.tmp` files and renames them into place.
- `OcrImagePolicy.MAX_BODY_BYTES = 20 * 1024 * 1024` and `OcrImagePolicy.MAX_PIXELS = 12 * 1024 * 1024`.
- `OcrImagePolicy.decode(bytes: ByteArray): DecodedImage` decodes a bounded Bitmap and applies EXIF orientation.
- `OcrResult(text: String, elapsedMs: Long, imageWidth: Int, imageHeight: Int, boxes: List<OcrBox>)`.
- `OcrBox(text: String, score: Float, points: List<OcrPoint>)`.

- [ ] **Step 1: Implement the smallest model-file code to make Task 2 green**

  Use the four constant names from Task 1, return false for missing/empty files, and copy each asset to `$name.tmp` before rename. Delete only the current temporary file when that file fails; do not delete a valid existing model file until the replacement is complete.

- [ ] **Step 2: Implement the image policy**

  Accept `image/jpeg`, `image/png`, and `image/webp`, ignoring a content-type parameter suffix. Reject null/blank/other types with the exact supported-type message. Decode with `BitmapFactory`, reject empty or undecodable bytes, reject images over the configured pixel limit, and rotate according to EXIF when a stream contains orientation metadata.

- [ ] **Step 3: Implement JSON escaping and result serialization**

  Escape backslash, quote, CR, LF, tab, and control characters. Serialize `success`, `text`, `elapsedMs`, `imageWidth`, `imageHeight`, and each box's `text`, `score`, and four or more point pairs. Keep errors in the same `{success:false,error:...}` shape.

- [ ] **Step 4: Run the focused tests and then all current tests**

  Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-rapidocr :app:testDebugUnitTest --tests 'com.aasc.rapidocr.*'`

  Expected: PASS for all new policy/model/JSON tests. Then run `npm test` from the repository only if the root script exists; otherwise do not invent a replacement root test command.

### Task 4: Add failing tests and implementation for OCR preprocessing, geometry, and CTC decoding

**Files:**
- Create: `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/OcrGeometryTest.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/CtcDecoderTest.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/OcrTensorPreprocessorTest.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/OcrGeometry.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/CtcDecoder.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/OcrTensorPreprocessor.kt`

**Interfaces:**
- `OcrPoint(x: Float, y: Float)` is an image-coordinate point used internally and converted to numeric JSON points at the boundary.
- `OcrGeometry.orderClockwise(points: List<OcrPoint>): List<OcrPoint>` returns top-left, top-right, bottom-right, bottom-left.
- `OcrGeometry.scaleToOriginal(points: List<OcrPoint>, scaleX: Float, scaleY: Float, offsetX: Float, offsetY: Float): List<OcrPoint>` maps detector coordinates back to the uploaded image.
- `CtcDecoder.decode(logits: Array<FloatArray>, dictionary: List<String>): DecodedText` removes repeated tokens and blank index zero, returning text and mean confidence.
- `OcrTensorPreprocessor.toNchw(pixels: IntArray, width: Int, height: Int): FloatArray` returns normalized RGB values in `[1,3,height,width]` flattened order; a separate Android adapter reads pixels from Bitmap.

- [ ] **Step 1: Write failing geometry and decoder tests**

  Assert clockwise ordering for shuffled quadrilateral points, inverse detector scaling, CTC collapse of `[blank, A, A, blank, B]` to `AB`, and confidence calculated only over emitted tokens. Assert dictionary bounds produce a controlled `IllegalArgumentException`.

- [ ] **Step 2: Run the new tests and confirm RED**

  Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-rapidocr :app:testDebugUnitTest --tests 'com.aasc.rapidocr.OcrGeometryTest' --tests 'com.aasc.rapidocr.CtcDecoderTest' --tests 'com.aasc.rapidocr.OcrTensorPreprocessorTest'`

  Expected: FAIL because the geometry, decoder, and tensor preprocessing functions are not implemented.

- [ ] **Step 3: Implement deterministic pure logic**

  Implement point ordering without a long if/else chain: compute centroid and polar angle, then rotate the ordered list so the smallest `x + y` point is first. Implement CTC with a single pass and explicit blank/repeat state. Normalize RGB using RapidOCR mean/std `[0.5, 0.5, 0.5]`, resize while preserving the selected model's detector/recognizer dimensions, and fill the NCHW buffer in channel-major order. Test the tensor helper with a synthetic `IntArray` so JVM tests do not call unavailable Android Bitmap framework methods.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

  Expected: all geometry, decoder, preprocessing, model, image and JSON tests PASS with no warnings.

### Task 5: Implement the ONNX Runtime RapidOCR engine

**Files:**
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/RapidOcrEngine.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/DbPostProcessor.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/PerspectiveCropper.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/OrientationClassifier.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/RecognitionDecoder.kt`
- Test: `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/*`

**Interfaces:**
- `class RapidOcrEngine { val isReady: Boolean; fun load(modelDir: File); fun recognize(bitmap: Bitmap): OcrResult; fun release() }`.
- `DbPostProcessor.extractBoxes(probabilityMap: FloatArray, mapWidth: Int, mapHeight: Int, originalWidth: Int, originalHeight: Int): List<List<OcrPoint>>`.
- `PerspectiveCropper.crop(bitmap: Bitmap, box: List<OcrPoint>): Bitmap`.
- `OrientationClassifier.correct(crop: Bitmap, session: OrtSession, environment: OrtEnvironment): Bitmap`.
- `RecognitionDecoder.decode(crop: Bitmap, session: OrtSession, environment: OrtEnvironment, dictionary: List<String>): DecodedText`.

- [ ] **Step 1: Add a non-native guard test for incomplete models**

  Add `RapidOcrEngineTest.rejectsIncompleteModelDirectoryBeforeCreatingSessions`, passing a temporary directory containing only one model file and asserting the error message is `RapidOCR 模型文件不完整`. Run it and confirm RED before implementing `RapidOcrEngine.load`.

- [ ] **Step 2: Implement session lifecycle**

  Initialize OpenCV before creating any `Mat`, then create one `OrtEnvironment`, one CPU `SessionOptions`, and three sessions. Read model input names at load time instead of assuming names. Set `isReady` only after all sessions and dictionary lines load. Close result tensors with `use`/`finally`, close sessions/options/environment references in `release`, and make `recognize` synchronized so the HTTP layer cannot enter two inference calls.

- [ ] **Step 3: Implement detector preprocessing and DB postprocessing**

  Use detector limit side length 736, normalize with mean/std 0.5, run the detector, threshold the probability map at 0.3, filter boxes by score 0.5, approximate contours/rotated rectangles with OpenCV, expand boxes with unclip ratio 1.6, and map points to original image coordinates. Sort boxes top-to-bottom and left-to-right.

- [ ] **Step 4: Implement classification and recognition**

  Crop each detected quadrilateral with perspective transformation. Resize classifier input to `[1,3,48,192]`, rotate crops when class `180` has score at least 0.9. Resize recognition crops to height 48 and width capped at 320, run `[1,3,48,320]` padded input, decode CTC with `ppocrv6_dict.txt`, and omit blank text boxes.

- [ ] **Step 5: Run JVM tests and compile the engine**

  Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-rapidocr :app:testDebugUnitTest`

  Expected: all pure logic and lifecycle tests PASS; the Android module compiles against ONNX Runtime and OpenCV without unresolved native classes.

### Task 6: Add failing HTTP server tests and implement the HTTP contract

**Files:**
- Create: `3rd/tts-server/android-rapidocr/app/src/test/java/com/aasc/rapidocr/OcrHttpServerTest.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/OcrHttpServer.kt`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/OcrWebPage.kt`
- Modify: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/OcrHttpJson.kt`

**Interfaces:**
- `OcrHttpServer(engine: RapidOcrEngine)`.
- `start(requestedPort: Int): Result<Int>` binds `0.0.0.0` and returns the actual port.
- `stop()` closes the socket, accept thread and client executor.
- `isRunning(): Boolean`, `addressText(): String`.
- Routes: `GET /`, `GET /index.html`, `GET /health`, `POST /api/ocr`.

- [ ] **Step 1: Write server contract tests first**

  Add tests for root HTML containing `RapidOCR`, `type="file"`, `/api/ocr`, and `/health`; health returning `modelReady:false` and `httpRunning:true` with an unloaded engine; unsupported Content-Type returning 415; unsupported method returning 405; and stopping the server making the next request fail to connect.

- [ ] **Step 2: Run the server tests and confirm RED**

  Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-rapidocr :app:testDebugUnitTest --tests 'com.aasc.rapidocr.OcrHttpServerTest'`

  Expected: FAIL because the server and embedded page do not exist.

- [ ] **Step 3: Implement the bounded socket parser**

  Copy the established ASR server pattern only for request parsing: 16 KiB headers, Content-Length body reads, 20 MiB limit, 65-second socket timeout, fixed two-client worker pool, `Connection: close`, and explicit status reasons. Do not add multipart parsing; the web page sends the selected image bytes directly with its MIME type.

- [ ] **Step 4: Implement the routes and inference boundary**

  Return 503 before decoding when the model is not ready, 409 when the single inference lock is occupied, 415 for unsupported image types, 400 for decode errors, 504 for the 60-second inference timeout, and 200 with `OcrHttpJson.success` on success. Close every decoded Bitmap in `finally`.

- [ ] **Step 5: Run focused server tests and all module tests**

  Expected: server contract tests and all previous tests PASS. Verify root page and JSON responses use UTF-8 and do not contain an external script, stylesheet, image, or network URL.

### Task 7: Implement the upload webpage and native APK control page

**Files:**
- Create: `3rd/tts-server/android-rapidocr/app/src/main/res/layout/activity_main.xml`
- Create/modify: `3rd/tts-server/android-rapidocr/app/src/main/res/values/strings.xml`
- Create/modify: `3rd/tts-server/android-rapidocr/app/src/main/res/values/themes.xml`
- Create: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/MainActivity.kt`
- Modify: `3rd/tts-server/android-rapidocr/app/src/main/AndroidManifest.xml`
- Modify: `3rd/tts-server/android-rapidocr/app/src/main/java/com/aasc/rapidocr/OcrWebPage.kt`

**Interfaces:**
- Native UI IDs: `modelStatus`, `httpPortInput`, `httpStatus`, `httpToggleButton`.
- Web UI IDs: `imageInput`, `imagePreview`, `recognizeButton`, `resultText`, `elapsedText`, `boxesOverlay`.

- [ ] **Step 1: Add the native layout and manifest**

  Add model status text, port input defaulting to `18080`, start/stop button, and address text. Add `android.permission.INTERNET` because the APK listens on a local socket. Keep no camera or external storage permission.

- [ ] **Step 2: Implement Activity lifecycle**

  On create, disable the HTTP button, copy/load models on a single background executor, then enable the button only when `RapidOcrEngine.isReady`. Validate ports in `1024..65535`; start/stop the server off the main thread; update UI only through a guarded `postUi` helper. On destroy, stop server, release engine, and shut down executor.

- [ ] **Step 3: Implement the embedded upload page**

  Use a single inline HTML document with no external resources. The file input accepts `.jpg`, `.jpeg`, `.png`, `.webp`; selected data is previewed with an object URL; clicking recognize sends the raw `ArrayBuffer` to `/api/ocr` with the original MIME; response text, elapsed time, scores, and point coordinates are rendered; a canvas overlay maps returned image coordinates to preview coordinates; errors preserve the selected image and show the HTTP error.

- [ ] **Step 4: Run static page contract tests and module tests**

  Add assertions to `OcrHttpServerTest` for upload MIME strings, `ArrayBuffer`, result fields, and canvas overlay. Run `:app:testDebugUnitTest` and expect all tests PASS.

### Task 8: Synchronize project scripts, documentation indexes, usage, and completion records

**Files:**
- Modify: `3rd/tts-server/package.json`
- Modify: `3rd/tts-server/readme.md`
- Modify: `3rd/tts-server/docs/design.md`
- Modify: `3rd/tts-server/docs/spec.md`
- Modify: `3rd/tts-server/docs/todo.md`
- Modify: `3rd/tts-server/changelog.md`
- Modify: `docs/design.md`
- Modify: `docs/spec.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Modify: `3rd/tts-server/docs/design/android-rapidocr-apk.md`
- Modify: `3rd/tts-server/docs/spec/android-rapidocr-apk.md`
- Modify: `3rd/tts-server/docs/task/2026-09-01_独立Android-RapidOCR-HTTP测试APK.md`

**Interfaces:**
- Documentation must describe the implemented route names, default port, supported image types, APK path, model source, and actual verification results.

- [ ] **Step 1: Update usage and indexes**

  Add the build command and curl example to `3rd/tts-server/readme.md`. Keep root and subproject design/spec indexes pointing to the same new design/spec files. Do not duplicate model files or claim a feature is production-ready.

- [ ] **Step 2: Record completion and remove active todo entries**

  Replace the in-progress entries with a completed task record containing the exact APK path, model names, modified files, and test/build results. Use the required changelog format:

  ```text
  ### Android RapidOCR 测试 APK

  - ✅ [2026-09-01] 新增独立 Android RapidOCR HTTP 测试 APK
    - 改动文件：...
    - 验证结果：...
  ```

- [ ] **Step 3: Run documentation consistency checks**

  Run: `rg -n 'android-rapidocr|RapidOCR|/api/ocr' 3rd/tts-server/docs docs 3rd/tts-server/readme.md` and `git diff --check`. Expected: all implemented route/model references point to the same names and no whitespace errors exist.

### Task 9: Verify the APK, manifest, assets, HTTP behavior, and workspace safety

**Files:**
- Test: `3rd/tts-server/android-rapidocr/app/build/outputs/apk/debug/app-debug.apk`
- Test: generated manifest and assets inside the APK

- [ ] **Step 1: Run the project-preferred build and unit tests**

  Run:

  ```bash
  npm --prefix 3rd/tts-server run build:android-rapidocr
  ../../src/apps/android-display/gradlew -p 3rd/tts-server/android-rapidocr :app:testDebugUnitTest
  ```

  Expected: both commands exit with code 0 and the APK exists at `3rd/tts-server/android-rapidocr/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 2: Verify APK metadata and bundled resources**

  Run:

  ```bash
  unzip -l 3rd/tts-server/android-rapidocr/app/build/outputs/apk/debug/app-debug.apk | rg 'rapidocr/(PP-OCRv6_det_small|ch_ppocr_mobile_v2.0_cls_mobile|PP-OCRv6_rec_small|ppocrv6_dict)'
  $ANDROID_HOME/build-tools/34.0.0/aapt dump badging 3rd/tts-server/android-rapidocr/app/build/outputs/apk/debug/app-debug.apk
  $ANDROID_HOME/build-tools/34.0.0/aapt dump permissions 3rd/tts-server/android-rapidocr/app/build/outputs/apk/debug/app-debug.apk
  ```

  Expected: all four assets are present, package is `com.aasc.rapidocr`, ABI is arm64-v8a, and only the required `android.permission.INTERNET` network permission is present.

- [ ] **Step 3: Run a local JVM HTTP smoke test**

  Execute the module HTTP tests against an ephemeral port and verify root/health/error responses. If an arm64 device is available, install the debug APK and run:

  ```bash
  curl http://DEVICE_IP:18080/health
  curl -X POST -H 'Content-Type: image/jpeg' --data-binary @test.jpg http://DEVICE_IP:18080/api/ocr
  ```

  Expected: health reports ready/running, and OCR returns `success:true`, non-negative `elapsedMs`, text, and boxes. Record if a real-device check is unavailable; do not claim it passed.

- [ ] **Step 4: Review only intended changes**

  Run `git status --short` and `git diff --stat`. Confirm no user-generated logs, Gradle caches, `.cxx`, `.kotlin`, APK build outputs, or unrelated source changes are added. Keep generated build outputs ignored/untracked.

- [ ] **Step 5: Commit isolated implementation changes**

  Stage only RapidOCR app files, model resources, package script, and the documentation files whose diff contains this task's changes. Use commit message:

  ```bash
  git commit -m "feat: add RapidOCR Android HTTP test APK"
  ```

  If a shared dirty file contains unrelated user edits that cannot be staged without them, leave that file unstaged and report it explicitly.
