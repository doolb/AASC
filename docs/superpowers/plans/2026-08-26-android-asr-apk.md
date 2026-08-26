# 独立 Android 离线语音识别 APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `3rd/tts-server/android-asr/` 构建一个内置 SenseVoice 模型的独立 Android 离线语音识别 APK，支持录音、音频文件、识别耗时、CPU 核心模式和局域网 HTTP 测试。

**Architecture:** 新 APK 独立于 `android-display` 和 `android-tts`，只通过相对路径引用已归档的 sherpa-onnx AAR。模型由 Gradle 从 `res/models/sensevoice` 复制到 assets；界面识别和内置 HTTP 服务共用 `AsrCoordinator` 的单线程识别管线。录音和文件输入都先归一化为 16kHz、单声道、Float32 样本，再交给 `AsrEngine`。

**Tech Stack:** Kotlin、Android Gradle Plugin 9、Android API 26+、sherpa-onnx 1.12.35、AudioRecord、MediaExtractor/MediaCodec、Java ServerSocket、JNI C++ `sched_setaffinity`、JUnit 4。

**Spec:** `docs/superpowers/specs/2026-08-26-android-asr-apk-design.md`

## Global Constraints

- APK 必须内置 `model.int8.onnx` 和 `tokens.txt`，运行时不得下载模型。
- 目标 ABI 仅为 `arm64-v8a`，最低 Android API 为 26。
- 识别输入统一为 16kHz、单声道、Float32；原始 PCM 按 16-bit little-endian 解释。
- 界面和 HTTP 识别必须共用单线程管线；识别占用时 HTTP 返回 409。
- HTTP 默认监听 `0.0.0.0:18080`，提供 `/health` 和 `/api/asr`，默认关闭服务。
- 单次音频限制为 60 秒；耗时只统计识别阶段，不包含模型加载、文件解码和 UI 更新。
- CPU 模式为自动、大核、小核；native 失败时返回自动回退状态，不阻塞识别。
- 代码注释使用中文，使用 `const/let` 规则对应 Kotlin 的不可变优先写法，所有跨线程/IO 操作使用 try-catch。

---

### Task 1: 建立 ASR 工程和模型打包边界

**Files:**
- Create: `3rd/tts-server/android-asr/settings.gradle.kts`
- Create: `3rd/tts-server/android-asr/build.gradle.kts`
- Create: `3rd/tts-server/android-asr/gradle.properties`
- Create: `3rd/tts-server/android-asr/app/build.gradle.kts`
- Create: `3rd/tts-server/android-asr/app/src/main/AndroidManifest.xml`
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrModelFiles.kt`
- Test: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/AsrModelFilesTest.kt`

**Interfaces:**
- Produces `AsrModelFiles.FILE_NAMES`, `isComplete(File): Boolean` and `ensureCopied(AssetManager, File)`。
- Gradle task `prepareBundledAsrModel` copies exactly `model.int8.onnx` and `tokens.txt`。

- [x] **Step 1: Write the failing test**

```kotlin
@Test
fun modelListRequiresSenseVoiceFiles() {
    assertEquals(listOf("model.int8.onnx", "tokens.txt"), AsrModelFiles.FILE_NAMES)
    val directory = Files.createTempDirectory("asr-model-").toFile()
    assertFalse(AsrModelFiles.isComplete(directory))
    File(directory, "model.int8.onnx").writeBytes(ByteArray(1))
    assertFalse(AsrModelFiles.isComplete(directory))
    File(directory, "tokens.txt").writeText("0 a")
    assertTrue(AsrModelFiles.isComplete(directory))
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-asr testDebugUnitTest --tests com.aasc.asr.AsrModelFilesTest`
Expected: FAIL because the ASR project and `AsrModelFiles` do not exist.

- [x] **Step 3: Write minimal implementation**

```kotlin
object AsrModelFiles {
    val FILE_NAMES = listOf("model.int8.onnx", "tokens.txt")

    fun isComplete(modelDir: File): Boolean =
        modelDir.isDirectory && FILE_NAMES.all { File(modelDir, it).isFile }

    fun ensureCopied(assetManager: AssetManager, modelDir: File) {
        require(modelDir.isDirectory || modelDir.mkdirs()) { "无法创建 ASR 模型目录" }
        FILE_NAMES.forEach { name ->
            val temp = File(modelDir, "$name.tmp")
            assetManager.open("asr/$name").use { input -> temp.outputStream().use { output -> input.copyTo(output) } }
            require(temp.renameTo(File(modelDir, name))) { "无法安装 ASR 模型文件：$name" }
        }
    }
}
```

Configure `arm64-v8a`, `minSdk=26`, sherpa AAR, `prepareBundledAsrModel`, and assets under `build/generated/assets/asr`.

- [x] **Step 4: Run test and build**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-asr testDebugUnitTest :app:assembleDebug`
Expected: JVM test passes and debug build produces an arm64 APK with both model assets.

- [x] **Step 5: Commit**

```bash
git add 3rd/tts-server/android-asr
git commit -m "feat: scaffold offline Android ASR APK"
```

### Task 2: 实现 PCM/WAV 和媒体文件输入

**Files:**
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrPcm.kt`
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/WavAudio.kt`
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AudioResampler.kt`
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AudioFileDecoder.kt`
- Create: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/WavAudioTest.kt`
- Test: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/AudioResamplerTest.kt`

**Interfaces:**
- `AsrPcm.decodeS16(bytes): FloatArray` decodes little-endian PCM。
- `WavAudio.decode(bytes): PcmAudio` parses PCM WAV and rejects malformed/non-PCM input。
- `AudioResampler.toMono16k(input: PcmAudio): FloatArray` converts channels and sample rate。
- `AudioFileDecoder.decode(context, uri): FloatArray` uses WAV parser first and `MediaExtractor`/`MediaCodec` for supported compressed media。

- [x] **Step 1: Write failing tests**

```kotlin
@Test
fun wavDecoderReadsPcmHeaderAndSamples() {
    val wav = TestWav.pcm(sampleRate = 8000, channels = 1, samples = shortArrayOf(0, 16384, -16384))
    val audio = WavAudio.decode(wav)
    assertEquals(8000, audio.sampleRate)
    assertEquals(1, audio.channels)
    assertArrayEquals(shortArrayOf(0, 16384, -16384), audio.samples)
}

@Test
fun resamplerProduces16kMono() {
    val audio = PcmAudio(8000, 2, shortArrayOf(1000, 3000, 2000, 4000))
    assertEquals(4, AudioResampler.toMono16k(audio).size)
}
```

- [x] **Step 2: Run tests to verify they fail**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-asr testDebugUnitTest --tests 'com.aasc.asr.*Audio*Test'`
Expected: FAIL because the audio value types and decoders do not exist.

- [x] **Step 3: Implement the minimum audio pipeline**

Use explicit little-endian reads, validate RIFF/WAVE/fmt/data chunks, support PCM 16-bit input, average interleaved channels, and linearly interpolate sample rates. The Android decoder must release extractor/codec in `finally`, drain output buffers with a 60-second decoded-duration cap, and throw Chinese error messages for unsupported tracks.

- [x] **Step 4: Run tests and static checks**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-asr testDebugUnitTest`
Expected: all PCM/WAV/resampling tests pass; malformed header, empty data, stereo and sample-rate cases are covered.

- [x] **Step 5: Commit**

```bash
git add 3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr 3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr
git commit -m "feat: add Android ASR audio input pipeline"
```

### Task 3: 实现 CPU affinity 和 SenseVoice 识别协调器

**Files:**
- Create: `3rd/tts-server/android-asr/app/src/main/cpp/CMakeLists.txt`
- Create: `3rd/tts-server/android-asr/app/src/main/cpp/cpu_affinity.cpp`
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/CpuMode.kt`
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/CpuAffinity.kt`
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrEngine.kt`
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrCoordinator.kt`
- Create: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/CpuModeTest.kt`
- Create: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/AsrCoordinatorTest.kt`

**Interfaces:**
- `CpuMode` exposes `AUTO`, `BIG`, `LITTLE` and persisted integer values。
- `CpuAffinity.apply(mode): String` never throws and returns the actual core/fallback status。
- `AsrEngine.load(context, modelFile, tokensFile): Boolean` and `recognize(samples): String`。
- `AsrCoordinator.recognize(samples, mode): RecognitionResult(text: String, elapsedMs: Long)` serializes all calls and rejects busy work。

- [x] **Step 1: Write failing tests**

```kotlin
@Test
fun cpuModeRoundTripsPersistedValues() {
    assertEquals(CpuMode.AUTO, CpuMode.fromPersistedValue(0))
    assertEquals(CpuMode.BIG, CpuMode.fromPersistedValue(1))
    assertEquals(CpuMode.LITTLE, CpuMode.fromPersistedValue(2))
}

@Test
fun durationIsMeasuredAroundRecognizerOnly() {
    val result = AsrCoordinator.measureForTest { "你好" }
    assertEquals("你好", result.text)
    assertTrue(result.elapsedMs >= 0)
}
```

- [x] **Step 2: Run tests to verify they fail**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-asr testDebugUnitTest --tests 'com.aasc.asr.*Test'`
Expected: FAIL because CPU mode and coordinator types do not exist.

- [x] **Step 3: Implement the minimum engine**

Copy the verified affinity algorithm into the `com.aasc.asr` JNI symbol, dynamically read `cpu_capacity` then `cpuinfo_max_freq`, and fall back to all CPUs. Build only `arm64-v8a`. Construct sherpa `OfflineRecognizer` with `FeatureConfig(16000)` and `OfflineSenseVoiceModelConfig`, release each stream in `finally`, and keep recognizer/load/recognize synchronized. `AsrCoordinator` uses a single-thread executor plus a non-blocking busy flag; it applies CPU mode before recognition and measures only the engine call.

- [x] **Step 4: Run tests and native build**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-asr testDebugUnitTest :app:assembleDebug`
Expected: unit tests pass, CMake builds `libcpu-affinity.so`, and APK contains SenseVoice assets plus the native library.

- [x] **Step 5: Commit**

```bash
git add 3rd/tts-server/android-asr
git commit -m "feat: add offline SenseVoice recognition core"
```

### Task 4: 实现录音、界面和 CPU 模式持久化

**Files:**
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AudioRecorder.kt`
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/MainActivity.kt`
- Create: `3rd/tts-server/android-asr/app/src/main/res/layout/activity_main.xml`
- Create: `3rd/tts-server/android-asr/app/src/main/res/values/strings.xml`
- Create: `3rd/tts-server/android-asr/app/src/main/res/values/themes.xml`
- Create: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/UiStatusTest.kt`

**Interfaces:**
- `AudioRecorder.start(): Boolean`, `stop(): FloatArray` records 16kHz mono PCM and returns samples。
- Main UI owns selected audio, recording state, model state, CPU Spinner, result text, elapsed time and HTTP status。

- [x] **Step 1: Write failing pure-logic tests**

```kotlin
@Test
fun resultStatusContainsTextAndElapsedMilliseconds() {
    assertEquals("识别完成，用时 1234 ms\n你好", UiStatus.result("你好", 1234))
}

@Test
fun blankAudioIsRejectedBeforeEngineCall() {
    assertEquals("没有可识别的音频", UiStatus.validate(FloatArray(0)))
}
```

- [x] **Step 2: Run tests to verify they fail**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-asr testDebugUnitTest --tests com.aasc.asr.UiStatusTest`
Expected: FAIL because UI status helper does not exist.

- [x] **Step 3: Implement UI and recorder**

Request `RECORD_AUDIO` at runtime; toggle the button between start and stop; write stopped samples as an in-memory WAV or temporary file. Use `ACTION_OPEN_DOCUMENT` with `audio/*`, decode selected URI on the background executor, disable recognition while loading, show model errors, and persist CPU mode through `SharedPreferences`. Never update views outside the main thread.

- [x] **Step 4: Run unit/build checks**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-asr testDebugUnitTest :app:assembleDebug`
Expected: UI logic tests pass and APK launches with model-loading status.

- [x] **Step 5: Commit**

```bash
git add 3rd/tts-server/android-asr
git commit -m "feat: add Android ASR recording UI"
```

### Task 5: 实现内置 HTTP 服务

**Files:**
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrHttpServer.kt`
- Create: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/HttpJson.kt`
- Create: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/HttpJsonTest.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/MainActivity.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/AndroidManifest.xml`

**Interfaces:**
- `AsrHttpServer.start(port): Result<Int>` binds `0.0.0.0` and returns actual port。
- `AsrHttpServer.stop()` closes the socket and executor。
- `GET /health` returns model/service/CPU state。
- `POST /api/asr` accepts raw `audio/wav` or `application/octet-stream` and returns JSON。

- [x] **Step 1: Write failing protocol tests**

```kotlin
@Test
fun successJsonContainsStableFields() {
    assertEquals(
        "{\"success\":true,\"text\":\"你好\",\"elapsedMs\":1234}",
        HttpJson.success("你好", 1234)
    )
}

@Test
fun errorJsonEscapesMessage() {
    assertEquals("{\"success\":false,\"error\":\"音频\\\"无效\",\"elapsedMs\":0}", HttpJson.error("音频\"无效"))
}
```

- [x] **Step 2: Run tests to verify they fail**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-asr testDebugUnitTest --tests com.aasc.asr.HttpJsonTest`
Expected: FAIL because HTTP JSON helpers do not exist.

- [x] **Step 3: Implement the HTTP server**

Use `ServerSocket(InetAddress.getByName("0.0.0.0"), port)` and a bounded executor. Parse request line/headers/body with a 20MB limit, reject unsupported methods/path/content type with 4xx, return 409 when `AsrCoordinator` is busy, decode WAV or raw 16-bit PCM, and close every socket in `finally`. The server must never expose model files or accept arbitrary filesystem paths.

- [x] **Step 4: Run protocol and build checks**

Run: `../../src/apps/android-display/gradlew -p 3rd/tts-server/android-asr testDebugUnitTest :app:assembleDebug`
Expected: JSON, status code, body limit, health and busy-path tests pass.

- [x] **Step 5: Commit**

```bash
git add 3rd/tts-server/android-asr
git commit -m "feat: add Android ASR HTTP test service"
```

### Task 6: 完成项目文档、脚本和验收

**Files:**
- Modify: `3rd/tts-server/.gitignore`
- Modify: `3rd/tts-server/package.json`
- Modify: `3rd/tts-server/readme.md`
- Modify: `docs/design.md`
- Modify: `docs/spec.md`
- Modify: `docs/todo.md`
- Modify: `3rd/tts-server/docs/design.md`
- Modify: `3rd/tts-server/docs/spec.md`
- Modify: `3rd/tts-server/changelog.md`
- Modify: `changelog.md`
- Test: `tests/android-asr-apk.test.js`

**Interfaces:**
- `npm --prefix 3rd/tts-server run build:android-asr` builds the debug APK。
- Static test checks package script, manifest permission, model source names, HTTP paths and `arm64-v8a`。

- [x] **Step 1: Write failing static tests**

```js
test('android ASR build script and project exist', () => {
  const pkg = JSON.parse(fs.readFileSync('3rd/tts-server/package.json', 'utf8'));
  assert.match(pkg.scripts['build:android-asr'], /android-asr/);
  assert.equal(fs.existsSync('3rd/tts-server/android-asr/app/build.gradle.kts'), true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/android-asr-apk.test.js`
Expected: FAIL because the build script and static test do not exist.

- [x] **Step 3: Update integration files and docs**

Add only the ASR build script and ASR-specific ignore rules; document model source, UI, CPU modes, HTTP endpoints, 60-second limit, default port and LAN warning. Remove the completed ASR item from `docs/todo.md` only after all checks pass and record the result in both changelogs.

- [x] **Step 4: Run full verification**

Run:

```bash
npm --prefix 3rd/tts-server run build:android-asr
../../src/apps/android-display/gradlew -p 3rd/tts-server/android-asr testDebugUnitTest
node --test tests/android-asr-apk.test.js
unzip -l 3rd/tts-server/android-asr/app/build/outputs/apk/debug/app-debug.apk | rg 'assets/asr/(model.int8.onnx|tokens.txt)|lib/arm64-v8a/libcpu-affinity.so'
adb install -r 3rd/tts-server/android-asr/app/build/outputs/apk/debug/app-debug.apk
```

Expected: all tests pass, APK contains both model assets and native library, installation succeeds, and the device can expose `/health` and recognize a test WAV from a LAN client.

- [x] **Step 5: Commit**

```bash
git add 3rd/tts-server docs tests/android-asr-apk.test.js
git commit -m "feat: add standalone offline Android ASR APK"
```
