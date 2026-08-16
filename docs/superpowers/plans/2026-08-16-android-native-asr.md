# Android 原生语音识别（SenseVoice / sherpa-onnx）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 android-display APK 内集成 sherpa-onnx Android AAR 原生运行 SenseVoice 语音识别，模型从 AASC 服务器按需下载，接入现有 asrAudio/asrResult 服务器中转流程，替代浏览器 WASM ASR。

**Architecture:** 服务器侧中转协议零改动，只新增一个模型文件下载接口 `GET /api/asr/model/<file>`。APK 侧新增 3 个原生桥方法（`asrStatus`/`asrEnsureModel`/`asrRecognize`），模型下载/加载由 `AsrModelManager` 管理，识别由 `AsrEngine` 封装 sherpa-onnx `OfflineRecognizer`。display.html 检测到原生桥后走原生识别路径（WebAudio 解码 webm→16kHz 裸 PCM→桥识别），录音方式完全不变（getUserMedia+MediaRecorder），浏览器环境行为不受影响。

**Tech Stack:** Kotlin / AGP 9.0（内置 Kotlin）、sherpa-onnx Android AAR、Android WebView、Node.js Express、原生 JavaScript。

## Global Constraints

- sherpa-onnx AAR 版本与服务器 sherpa-onnx-node 对齐：**1.12.35**（如 Maven Central 无此版本，改用解析到的最新版，见 Task 1 步骤 3）
- 桥接口 JSON 约定沿用现有 `takeScreenshot`/`compute` 先例（同步返回 String JSON）
- 原生桥识别输入契约：**只收裸 PCM（16kHz mono s16le）的 base64**，容器解码在 JS 侧 WebAudio 完成
- 识别路径统一服务器中转：APK 自己的麦克风录音照旧上传服务器，按 `asr.device` 分发
- 模型文件：`model.int8.onnx` + `tokens.txt`，白名单下载，不做断点续传
- 录音方式不变（getUserMedia+MediaRecorder），APK 只补 `RECORD_AUDIO` 权限 + `onPermissionRequest` 授权
- 所有代码注释用中文；不使用 `var`；异步用 async/await；错误处理用 try-catch
- 不产生一大段 if-else-if 链（AASC 规则），分支逻辑用早期 return / 映射表

---

### Task 1: 引入 sherpa-onnx Android AAR 依赖

**Files:**
- Modify: `src/apps/android-display/app/build.gradle.kts`
- Test: `src/apps/android-display/app/build.gradle.kts`（构建验证）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: Gradle 依赖 `com.k2fsa.sherpa.onnx:sherpa-onnx:1.12.35` 可解析，后续任务直接 `import com.k2fsa.sherpa.onnx.*`

- [ ] **Step 1: 在 dependencies 块添加 AAR 依赖**

修改 `src/apps/android-display/app/build.gradle.kts` 的 `dependencies` 块：

```kotlin
dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.k2fsa.sherpa.onnx:sherpa-onnx:1.12.35")
    testImplementation("junit:junit:4.13.2")
    // JVM 单元测试中 android.jar 的 org.json 是 stub（抛 "not mocked"），
    // 引入真实实现以覆盖 android.jar 的桩实现
    testImplementation("org.json:json:20240303")
}
```

- [ ] **Step 2: 编译验证依赖可解析**

Run: `cd src/apps/android-display && ./gradlew :app:compileDebugKotlin`
Expected: `BUILD SUCCESSFUL`（AAR 的 jniLibs 自动打进 APK，无需额外 packagingOptions 配置）

- [ ] **Step 3: 版本解析失败时的回退**

若 1.12.35 报 `Could not resolve com.k2fsa.sherpa.onnx:sherpa-onnx:1.12.35`，则：

1. 查询可用版本：浏览器打开 `https://repo1.maven.org/maven2/com/k2fsa/sherpa/onnx/sherpa-onnx/maven-metadata.xml`，取 `<latest>` 值
2. 将版本号改为该值，重新执行 Step 2 直到 BUILD SUCCESSFUL
3. 在 Task 9 的 changelog 里注明实际使用的 AAR 版本（若与服务器 1.12.35 不一致，记录差异原因）

- [ ] **Step 4: 提交**

```bash
git add src/apps/android-display/app/build.gradle.kts
git commit -m "build(android): 引入 sherpa-onnx AAR 依赖"
```

---

### Task 2: AsrPcm 纯逻辑（s16le ↔ Float32 转换）+ 单测

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/AsrPcm.kt`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/AsrPcmTest.kt`

**Interfaces:**
- Consumes: 无
- Produces: `object AsrPcm { fun decodeS16(bytes: ByteArray): FloatArray; fun encodeS16(samples: FloatArray): ByteArray }` — Task 5 的 `asrRecognize` 用它把 base64 解码后的 PCM 字节转成 sherpa-onnx 需要的 Float32 样本

- [ ] **Step 1: 写失败测试**

创建 `src/apps/android-display/app/src/test/java/com/aasc/display/AsrPcmTest.kt`：

```kotlin
package com.aasc.display

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class AsrPcmTest {

    @Test
    fun decodeS16_标准样本转Float32() {
        // 两个 s16le 样本：32767 → 1.0（近似），-32768 → -1.0，0 → 0.0
        val bytes = byteArrayOf(
            0xFF.toByte(), 0x7F.toByte(),  // 32767
            0x00.toByte(), 0x80.toByte(),  // -32768
            0x00.toByte(), 0x00.toByte()   // 0
        )
        val out = AsrPcm.decodeS16(bytes)
        assertEquals(3, out.size)
        assertArrayEquals(
            floatArrayOf(0.9999695f, -1.0f, 0.0f),
            out,
            1e-5f
        )
    }

    @Test
    fun decodeS16_奇数长度忽略最后一个字节() {
        val bytes = byteArrayOf(0x00, 0x00, 0x01)  // 3 字节，只能解出 1 个样本
        val out = AsrPcm.decodeS16(bytes)
        assertEquals(1, out.size)
        assertEquals(0.0f, out[0], 1e-6f)
    }

    @Test
    fun decodeS16_空输入返回空数组() {
        assertEquals(0, AsrPcm.decodeS16(ByteArray(0)).size)
    }

    @Test
    fun encodeS16_与decodeS16往返一致() {
        val samples = floatArrayOf(0.5f, -0.5f, 0.0f, 1.0f, -1.0f)
        val bytes = AsrPcm.encodeS16(samples)
        val roundTrip = AsrPcm.decodeS16(bytes)
        assertArrayEquals(samples, roundTrip, 1e-3f)
    }

    @Test
    fun encodeS16_越界值被clamp到[-1,1]() {
        val bytes = AsrPcm.encodeS16(floatArrayOf(1.5f, -2.0f))
        val out = AsrPcm.decodeS16(bytes)
        assertEquals(1.0f, out[0], 1e-3f)
        assertEquals(-1.0f, out[1], 1e-3f)
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests "com.aasc.display.AsrPcmTest"`
Expected: FAIL（`AsrPcm` 未定义，编译错误）

- [ ] **Step 3: 写实现**

创建 `src/apps/android-display/app/src/main/java/com/aasc/display/AsrPcm.kt`：

```kotlin
package com.aasc.display

// 16kHz mono s16le 裸 PCM 与 Float32 样本互转（纯逻辑，供原生 ASR 引擎输入与 JVM 单测）
// 注意：不依赖 android.util.Base64（JVM 单测是 stub），base64 编解码由 NativeBridge 负责
object AsrPcm {

    // ByteArray(s16le PCM) → Float32Array，归一化到 [-1,1]（sherpa-onnx 期望 Float32 样本）
    fun decodeS16(bytes: ByteArray): FloatArray {
        val count = bytes.size / 2
        val out = FloatArray(count)
        for (i in 0 until count) {
            val lo = bytes[i * 2].toInt() and 0xFF
            val hi = bytes[i * 2 + 1].toInt()
            val s = (lo or (hi shl 8)).toShort()
            out[i] = s / 32768.0f
        }
        return out
    }

    // Float32Array → ByteArray(s16le)，越界值 clamp 到 [-1,1]
    fun encodeS16(samples: FloatArray): ByteArray {
        val out = ByteArray(samples.size * 2)
        for (i in samples.indices) {
            val clamped = samples[i].coerceIn(-1.0f, 1.0f)
            val s = (if (clamped < 0f) (clamped * 0x8000).toInt() else (clamped * 0x7fff).toInt())
            out[i * 2] = (s and 0xFF).toByte()
            out[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
        }
        return out
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests "com.aasc.display.AsrPcmTest"`
Expected: PASS（5 个测试全部通过）

- [ ] **Step 5: 提交**

```bash
git add src/apps/android-display/app/src/main/java/com/aasc/display/AsrPcm.kt src/apps/android-display/app/src/test/java/com/aasc/display/AsrPcmTest.kt
git commit -m "feat(android): AsrPcm s16le↔Float32 转换 + 单测"
```

---

### Task 3: AsrModelManager（模型下载/校验/加载/状态机）

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelFiles.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelManager.kt`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/AsrModelFilesTest.kt`

**Interfaces:**
- Consumes: `AsrEngine.load(modelFile: File, tokensFile: File): Boolean`（Task 4 提供，本任务先按此签名调用，Task 4 实现前编译通过即可——Task 3 与 Task 4 可并行开发，若先后执行则先做 Task 4）
- Produces: `class AsrModelManager(context: Context) { val state/progress/lastError; fun statusJson(): JSONObject; fun ensureModel(baseUrl: String, onModelEvent: (JSONObject) -> Unit): String }` — Task 5 的 `asrEnsureModel`/`asrStatus` 调用它

- [ ] **Step 1: 写失败测试（模型完整性校验）**

创建 `src/apps/android-display/app/src/test/java/com/aasc/display/AsrModelFilesTest.kt`：

```kotlin
package com.aasc.display

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class AsrModelFilesTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun writeFile(name: String, size: Long): File {
        val f = tmp.newFile(name)
        f.writeBytes(ByteArray(size.toInt()))
        return f
    }

    @Test
    fun needsDownload_模型和tokens都齐全且模型够大返回false() {
        val model = writeFile("model.int8.onnx", 200L * 1024 * 1024)
        val tokens = writeFile("tokens.txt", 100)
        assertFalse(AsrModelFiles.needsDownload(model, tokens))
    }

    @Test
    fun needsDownload_缺tokens返回true() {
        val model = writeFile("model.int8.onnx", 200L * 1024 * 1024)
        // 不创建 tokens.txt
        assertTrue(AsrModelFiles.needsDownload(model, File(tmp.root, "tokens.txt")))
    }

    @Test
    fun needsDownload_模型过小视为损坏需重下() {
        val model = writeFile("model.int8.onnx", 1024)  // 远小于 MIN_MODEL_SIZE
        val tokens = writeFile("tokens.txt", 100)
        assertTrue(AsrModelFiles.needsDownload(model, tokens))
    }
}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests "com.aasc.display.AsrModelFilesTest"`
Expected: FAIL（`AsrModelFiles` 未定义）

- [ ] **Step 3: 写实现 AsrModelFiles**

创建 `src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelFiles.kt`：

```kotlin
package com.aasc.display

import java.io.File

// 模型文件完整性校验（纯逻辑，JVM 可测）。SenseVoice int8 实际约 234MB，50MB 阈值做损坏兜底
object AsrModelFiles {
    const val MIN_MODEL_SIZE_BYTES = 50L * 1024 * 1024

    // 是否需要（重新）下载：缺任一文件，或模型文件过小视为损坏
    fun needsDownload(modelFile: File, tokensFile: File): Boolean {
        if (!modelFile.isFile || !tokensFile.isFile) return true
        return modelFile.length() < MIN_MODEL_SIZE_BYTES
    }

    // 清理损坏的模型文件（下载/加载自检失败后调用）
    fun purge(modelFile: File, tokensFile: File) {
        modelFile.delete()
        tokensFile.delete()
        File(modelFile.parentFile, modelFile.name + ".tmp").delete()
        File(tokensFile.parentFile, tokensFile.name + ".tmp").delete()
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests "com.aasc.display.AsrModelFilesTest"`
Expected: PASS

- [ ] **Step 5: 写 AsrModelManager 实现**

创建 `src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelManager.kt`：

```kotlin
package com.aasc.display

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// 原生 ASR 模型管理：下载/校验/加载/状态机
// 状态：not_ready → downloading → ready | error（error 或损坏后再次 ensureModel 会重新下载）
class AsrModelManager(
    private val context: Context,
    private val uiHandler: Handler = Handler(Looper.getMainLooper())
) {
    private val modelDir = File(context.filesDir, "models/sensevoice")
    private val modelFile = File(modelDir, "model.int8.onnx")
    private val tokensFile = File(modelDir, "tokens.txt")
    private val downloadPool: ExecutorService = Executors.newSingleThreadExecutor()
    private val lock = Any()

    @Volatile var state: String = "not_ready"
        private set
    @Volatile var progress: Int = 0
        private set
    @Volatile var lastError: String = ""
        private set

    val isReady: Boolean get() = state == "ready"

    fun statusJson(): JSONObject = JSONObject()
        .put("state", state)
        .put("progress", progress)
        .put("error", lastError)

    // 幂等触发：ready 返回 "ready"；downloading 返回 "downloading"；否则启动下载返回 "downloading"
    fun ensureModel(baseUrl: String, onModelEvent: (JSONObject) -> Unit): String {
        synchronized(lock) {
            if (state == "ready") return "ready"
            if (state == "downloading") return "downloading"
            state = "downloading"
            progress = 0
            lastError = ""
        }
        downloadPool.execute {
            try {
                modelDir.mkdirs()
                val modelUrl = "$baseUrl/api/asr/model/model.int8.onnx"
                val tokensUrl = "$baseUrl/api/asr/model/tokens.txt"
                // 先下载 tokens（小文件），再下载模型（大文件，进度上屏）
                val okTokens = downloadFile(tokensUrl, tokensFile) { /* tokens 很小，不细分进度 */ }
                val okModel = okTokens && downloadFile(modelUrl, modelFile) { p ->
                    progress = p
                    postModelEvent(JSONObject().put("state", "downloading").put("progress", p), onModelEvent)
                }
                if (okModel && AsrEngine.load(modelFile, tokensFile)) {
                    state = "ready"
                    postModelEvent(JSONObject().put("state", "ready"), onModelEvent)
                } else {
                    state = "error"
                    lastError = if (okModel) "模型加载自检失败" else "模型下载失败"
                    AsrModelFiles.purge(modelFile, tokensFile)
                    postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
                }
            } catch (e: Exception) {
                state = "error"
                lastError = e.message ?: "模型下载异常"
                postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
            }
        }
        return "downloading"
    }

    private fun postModelEvent(json: JSONObject, onModelEvent: (JSONObject) -> Unit) {
        uiHandler.post { onModelEvent(json) }
    }

    // 下载到 .tmp 后原子改名（整文件重下，不做断点续传）；失败返回 false
    private fun downloadFile(urlStr: String, dest: File, onProgress: (Int) -> Unit): Boolean {
        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000
            readTimeout = 60000
        }
        return try {
            val total = conn.contentLengthLong
            val tmp = File(dest.parentFile, dest.name + ".tmp")
            conn.inputStream.use { input ->
                FileOutputStream(tmp).use { output ->
                    val buf = ByteArray(64 * 1024)
                    var downloaded = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        downloaded += n
                        if (total > 0) onProgress((downloaded * 100 / total).toInt())
                    }
                }
            }
            if (conn.responseCode !in 200..299) return false
            if (!tmp.renameTo(dest)) {
                tmp.copyTo(dest, overwrite = true)
                tmp.delete()
            }
            true
        } catch (_: Exception) {
            false
        } finally {
            conn.disconnect()
        }
    }
}
```

- [ ] **Step 6: 编译验证（依赖 Task 4 的 AsrEngine 签名）**

Run: `cd src/apps/android-display && ./gradlew :app:compileDebugKotlin`
Expected: 若 Task 4 已完成则 BUILD SUCCESSFUL；若 Task 4 尚未完成，此步报 `AsrEngine` 未解析属预期，先跳到 Task 4 再回来编译。

- [ ] **Step 7: 提交**

```bash
git add src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelFiles.kt src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelManager.kt src/apps/android-display/app/src/test/java/com/aasc/display/AsrModelFilesTest.kt
git commit -m "feat(android): AsrModelManager 模型下载/校验/加载状态机"
```

---

### Task 4: AsrEngine（sherpa-onnx OfflineRecognizer 封装）

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/AsrEngine.kt`

**Interfaces:**
- Consumes: 无（只依赖 Task 1 的 AAR）
- Produces: `object AsrEngine { val isLoaded: Boolean; fun load(modelFile: File, tokensFile: File): Boolean; @Throws(Exception::class) fun recognize(samples: FloatArray): String }` — Task 3 调用 `load`，Task 5 调用 `recognize`

- [ ] **Step 1: 写实现**

创建 `src/apps/android-display/app/src/main/java/com/aasc/display/AsrEngine.kt`：

```kotlin
package com.aasc.display

import com.k2fsa.sherpa.onnx.FeatureExtractorConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig
import java.io.File

// sherpa-onnx OfflineRecognizer 封装（SenseVoice int8，与服务器 asr-service.js 同配置对齐）
object AsrEngine {
    private var recognizer: OfflineRecognizer? = null

    val isLoaded: Boolean get() = recognizer != null

    // 加载模型，失败返回 false 不抛异常（由调用方做损坏清理）
    fun load(modelFile: File, tokensFile: File): Boolean {
        return try {
            val config = OfflineRecognizerConfig(
                featConfig = FeatureExtractorConfig(sampleRate = 16000),
                modelConfig = OfflineModelConfig(
                    senseVoice = OfflineSenseVoiceModelConfig(
                        model = modelFile.absolutePath,
                        language = "auto",
                        useInverseTextNormalization = 1
                    ),
                    tokens = tokensFile.absolutePath,
                    numThreads = 1,
                    debug = false,
                    provider = "cpu"
                )
            )
            recognizer = OfflineRecognizer(config)
            true
        } catch (e: Exception) {
            recognizer = null
            false
        }
    }

    // 一次性识别：输入 16kHz mono Float32 样本，输出文本（空输入/未加载抛异常）
    @Throws(Exception::class)
    fun recognize(samples: FloatArray): String {
        val rec = recognizer ?: throw IllegalStateException("ASR 引擎未加载")
        if (samples.isEmpty()) throw IllegalArgumentException("音频数据为空")
        val stream = rec.createStream()
        try {
            stream.acceptWaveform(samples, 16000)
            stream.inputFinished()
            val result = rec.decode(stream)
            return result.text.trim()
        } finally {
            // sherpa-onnx Android 的 stream 内存由 recognizer 管理，decode 后无需显式释放
        }
    }
}
```

> **API 签名核对点（编译时验证）**：sherpa-onnx Android 的 Kotlin 绑定构造函数若与上例有出入（如 `OfflineModelConfig` 有更多可选参数或参数顺序不同），以 `./gradlew :app:compileDebugKotlin` 报错为准调整具名参数即可。核心方法 `createStream()/acceptWaveform(FloatArray, Int)/inputFinished()/decode(OfflineStream).text` 为稳定公开 API。

- [ ] **Step 2: 编译验证**

Run: `cd src/apps/android-display && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL（若构造函数签名报错，按上一步提示调整）

- [ ] **Step 3: 提交**

```bash
git add src/apps/android-display/app/src/main/java/com/aasc/display/AsrEngine.kt
git commit -m "feat(android): AsrEngine 封装 sherpa-onnx OfflineRecognizer"
```

---

### Task 5: NativeBridge 新增 ASR 桥方法

**Files:**
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`
- Test: `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`（编译验证）

**Interfaces:**
- Consumes: `AsrModelManager`（Task 3）、`AsrEngine`（Task 4）、`AsrPcm.decodeS16`（Task 2）
- Produces: `@JavascriptInterface fun asrStatus(): String`、`fun asrEnsureModel(): String`、`fun asrRecognize(pcmBase64: String): String`，以及原生→JS 回调 `window.onNativeAsrModel({...})` — Task 8 的 display.html 调用它们

- [ ] **Step 1: 修改 NativeBridge，新增字段与导入**

在 `NativeBridge.kt` 顶部 import 区追加：

```kotlin
import android.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
```

在类体内（`takeScreenshot` 方法之前）追加：

```kotlin
    // ---- ASR 原生识别桥（sherpa-onnx，模型按需下载）----
    private val asrModelManager = AsrModelManager(webView.context)
    // 识别串行化：单线程执行器避免并发识别（与服务器单请求语义一致），future.get 带超时
    private val asrExecutor = Executors.newSingleThreadExecutor()
```

- [ ] **Step 2: 在 compute() 方法之后追加 3 个桥方法**

```kotlin
    // 查询原生 ASR 引擎状态：{"state":"ready|downloading|not_ready|error","progress":0-100,"error":"..."}
    @JavascriptInterface
    fun asrStatus(): String {
        return asrModelManager.statusJson().toString()
    }

    // 触发模型下载+加载（幂等）。就绪返回 "ready"，下载中/刚触发返回 "downloading"
    // 进度与结果通过 window.onNativeAsrModel 回调（主线程 evaluateJavascript）
    @JavascriptInterface
    fun asrEnsureModel(): String {
        val baseUrl = serverBaseUrl()
        if (baseUrl.isEmpty()) return JSONObject().put("error", "无法确定服务器地址").toString()
        return asrModelManager.ensureModel(baseUrl) { event ->
            val js = "window.onNativeAsrModel && window.onNativeAsrModel(${event.toString()});"
            webView.evaluateJavascript(js, null)
        }
    }

    // 一次性识别：输入裸 PCM（16kHz mono s16le）的 base64，同步返回 {"text":"..."} 或 {"error":"..."}
    // 识别在工作线程串行执行（asrExecutor），桥调用阻塞最多 20s（同 takeScreenshot 阻塞先例）
    @JavascriptInterface
    fun asrRecognize(pcmBase64: String): String {
        return try {
            if (!asrModelManager.isReady) {
                return JSONObject().put("error", "模型未就绪").toString()
            }
            val bytes = Base64.decode(pcmBase64, Base64.DEFAULT)
            val samples = AsrPcm.decodeS16(bytes)
            val text = asrExecutor.submit<java.util.concurrent.Callable<String>> {
                AsrEngine.recognize(samples)
            }.get(20, TimeUnit.SECONDS)
            JSONObject().put("text", text).toString()
        } catch (e: java.util.concurrent.TimeoutException) {
            JSONObject().put("error", "识别超时").toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "识别失败").toString()
        }
    }

    // 从 WebView 当前 URL 推导服务器 origin（模型下载地址基准）
    private fun serverBaseUrl(): String {
        return try {
            val u = android.net.Uri.parse(webView.url)
            val port = if (u.port != -1) ":${u.port}" else ""
            "${u.scheme}://${u.host}$port"
        } catch (e: Exception) {
            ""
        }
    }
```

- [ ] **Step 3: 编译验证**

Run: `cd src/apps/android-display && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: 提交**

```bash
git add src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt
git commit -m "feat(android): NativeBridge 新增 asrStatus/asrEnsureModel/asrRecognize 桥"
```

---

### Task 6: 录音权限补全（Manifest + 运行时权限 + onPermissionRequest）

**Files:**
- Modify: `src/apps/android-display/app/src/main/AndroidManifest.xml`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt`
- Test: 编译验证 + 真机验证（见 Step 4）

**Interfaces:**
- Consumes: 无
- Produces: APK 内 `getUserMedia({audio:true})` 可用（`RECORD_AUDIO` 已授权、`onPermissionRequest` 自动 grant），Task 8 的录音路径直接生效

- [ ] **Step 1: Manifest 加录音权限**

`src/apps/android-display/app/src/main/AndroidManifest.xml` 第 3 行（`INTERNET` 权限之后）追加：

```xml
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
```

- [ ] **Step 2: MainActivity 请求运行时权限**

`MainActivity.kt` 追加 import：

```kotlin
import android.Manifest
import android.content.pm.PackageManager
```

在类内追加权限请求常量与回调（放在 `onCreate` 之前）：

```kotlin
    private val REQ_AUDIO_PERMISSION = 1001

    private fun requestAudioPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 23 &&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_AUDIO_PERMISSION)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_AUDIO_PERMISSION && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            // 授权成功即重载页面，让 display.html 的 getUserMedia 能力探测通过
            webView?.reload()
        }
    }
```

在 `onCreate` 末尾（`if (!saved.isNullOrEmpty()) { connect() }` 之后）追加调用：

```kotlin
        requestAudioPermissionIfNeeded()
```

- [ ] **Step 3: DisplayWebView 覆写 onPermissionRequest 授予音频采集**

`DisplayWebView.kt` 追加 import：

```kotlin
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
```

在 `init` 块末尾（`requestFocus()` 之后）追加：

```kotlin
        // getUserMedia 音频采集：APK 内直接授予，无需弹窗（无人值守的显示端）
        webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val granted = request.resources.filter { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                if (granted.isNotEmpty()) {
                    request.grant(granted.toTypedArray())
                } else {
                    request.deny()
                }
            }
        }
```

- [ ] **Step 4: 编译验证**

Run: `cd src/apps/android-display && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: 提交**

```bash
git add src/apps/android-display/app/src/main/AndroidManifest.xml src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt
git commit -m "feat(android): APK 录音权限 + WebView getUserMedia 音频授权"
```

---

### Task 7: 服务器新增模型下载接口

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
- Test: curl 手工验证（见 Step 3）

**Interfaces:**
- Consumes: 无（`RES_DIR`/`path`/`fs` 均为现有常量/模块）
- Produces: `GET /api/asr/model/<filename>`（filename ∈ {model.int8.onnx, tokens.txt}，流式返回 + Content-Length）— Task 3 的 `AsrModelManager` 下载它

- [ ] **Step 1: 在 `/api/asr/status` 路由（约 1043-1050 行）之后插入接口**

```js
// ASR 模型文件下载（Android 原生识别引擎按需拉取；filename 白名单防路径穿越）
const ASR_MODEL_DIR = path.join(RES_DIR, 'models', 'sensevoice');
const ASR_MODEL_FILES = ['model.int8.onnx', 'tokens.txt'];

app.get('/api/asr/model/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!ASR_MODEL_FILES.includes(filename)) {
        return res.status(400).json({ status: 'error', message: '非法文件名' });
    }
    const filePath = path.join(ASR_MODEL_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ status: 'error', message: '模型文件不存在' });
    }
    res.setHeader('Content-Type', filename.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(filePath).size);
    fs.createReadStream(filePath).pipe(res);
});
```

- [ ] **Step 2: 重启服务器**

Run: `cd /mnt/AASC && npm start`（或项目现有启动方式），等待 "server listening"

- [ ] **Step 3: curl 验证**

```bash
# 正常下载模型文件：200，Content-Length ≈ 234MB
curl -sI http://localhost:<端口>/api/asr/model/model.int8.onnx | grep -E "HTTP|Content-Length"
# tokens 文件：200，text/plain
curl -sI http://localhost:<端口>/api/asr/model/tokens.txt | grep -E "HTTP|Content-Type"
# 非法文件名（路径穿越）：400
curl -s http://localhost:<端口>/api/asr/model/../../etc/passwd | head -c 200
# 不存在文件：404
curl -s http://localhost:<端口>/api/asr/model/foo.bin
```

Expected: 前两条 200 且 Content-Length 与 `ls -l res/models/sensevoice/` 一致；第三条 400 非法文件名；第四条 404。

- [ ] **Step 4: 提交**

```bash
git add src/apps/server/boot/server-app.js
git commit -m "feat(server): ASR 模型下载接口 GET /api/asr/model/<file>"
```

---

### Task 8: display.html 接入原生 ASR 路径

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Test: 真机链路手工验证（见 Step 5）

**Interfaces:**
- Consumes: `nativeBridge.asrStatus()/asrEnsureModel()/asrRecognize(pcmBase64)` + `window.onNativeAsrModel`（Task 5）
- Produces: APK 下 `voiceRecognition` 能力由原生引擎状态决定、`handleAsrAudio` 走原生识别、WASM 加载被跳过、模型下载进度上屏、`asrConfig` 开关映射原生引擎

- [ ] **Step 1: 顶部加原生 ASR 能力常量与事件回调**

在 `display.html` 约 91 行（`let localAsrAvailable = false;` 之后）追加：

```js
        // APK 原生 ASR 引擎（sherpa-onnx AAR）：检测到桥方法即认为可用，不再加载 WASM
        const nativeAsrAvailable = !!(window.NativeDisplay && window.NativeDisplay.asrStatus);
        let nativeAsrReady = false;
```

在同区域追加模型事件回调（`updateVoiceTextDisplay`/`displayWs`/`currentCapabilities` 均为同脚本顶层作用域变量，调用时已就绪）：

```js
        // 原生 ASR 模型下载/加载事件（由 NativeBridge evaluateJavascript 触发）
        window.onNativeAsrModel = function(payload) {
            if (!payload) return;
            if (payload.state === 'downloading') {
                updateVoiceTextDisplay('语音模型下载中 ' + (payload.progress || 0) + '%', false);
            } else if (payload.state === 'ready') {
                nativeAsrReady = true;
                updateVoiceTextDisplay('语音识别已就绪', true);
                setTimeout(() => updateVoiceTextDisplay('', true), 2000);
                // 模型就绪后重新上报能力，让服务器 findDisplayWithAsr 能选中本机
                if (displayWs && displayWs.readyState === WebSocket.OPEN && currentCapabilities) {
                    currentCapabilities.voiceRecognition = true;
                    displayWs.send(JSON.stringify({ type: 'capabilities', capabilities: currentCapabilities }));
                }
            } else if (payload.state === 'error') {
                nativeAsrReady = false;
                updateVoiceTextDisplay('语音模型下载失败: ' + (payload.error || '未知错误'), true);
                setTimeout(() => updateVoiceTextDisplay('', true), 4000);
            }
        };
```

- [ ] **Step 2: 能力探测改走原生状态**

将 `detectCapabilities`（约 2681-2693 行）的 `voiceRecognition` 判定块替换为：

```js
            if (nativeAsrAvailable) {
                // APK 原生识别引擎：按模型就绪状态声明能力，未就绪时触发下载
                try {
                    const st = JSON.parse(nativeBridge.asrStatus());
                    nativeAsrReady = (st.state === 'ready');
                    capabilities.voiceRecognition = nativeAsrReady;
                    if (st.state === 'not_ready' || st.state === 'error') {
                        nativeBridge.asrEnsureModel();
                    }
                } catch (e) {
                    capabilities.voiceRecognition = false;
                }
            } else if (localAsrAvailable || voiceSupported) {
                capabilities.voiceRecognition = true;
            } else {
                try {
                    const response = await fetch('/api/asr/status');
                    const result = await response.json();
                    if (result.available || result.ready) {
                        capabilities.voiceRecognition = true;
                    }
                } catch (e) {
                    capabilities.voiceRecognition = false;
                }
            }
```

- [ ] **Step 3: 跳过 WASM 加载（3 处早期返回）**

`checkAsrStatus`（约 2899 行）函数体开头追加：

```js
                async function checkAsrStatus() {
            if (nativeAsrAvailable) {
                console.log('显示端原生 ASR 引擎可用');
                return;  // 原生引擎由 asrEnsureModel 下载模型，就绪后 onNativeAsrModel 重新上报能力
            }
            try {
```

`forceInitLocalAsr`（约 2855 行）函数体开头追加：

```js
        async function forceInitLocalAsr() {
            if (nativeAsrAvailable) return false;  // 原生引擎负责识别，不加载 WASM
            try {
```

`initLocalAsr`（约 2928 行）函数体开头追加：

```js
        async function initLocalAsr() {
            if (nativeAsrAvailable) return false;  // 原生引擎负责识别，不加载 WASM
            try {
```

- [ ] **Step 4: handleAsrAudio 改走原生识别 + 追加 WebAudio 解码助手**

将 `handleAsrAudio`（约 2813-2849 行）整体替换为：

```js
        async function handleAsrAudio(data) {
            // APK 原生识别路径：webm/wav base64 → WebAudio 解码重采样 16k mono → 裸 PCM → 原生引擎
            if (nativeAsrAvailable) {
                if (!nativeAsrReady) {
                    const st = JSON.parse(nativeBridge.asrStatus());
                    if (st.state === 'not_ready' || st.state === 'error') {
                        nativeBridge.asrEnsureModel();
                    }
                    if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                        displayWs.send(JSON.stringify({
                            type: 'asrResult',
                            requestId: data.requestId,
                            error: '模型下载中',
                            text: ''
                        }));
                    }
                    return;
                }
                try {
                    const pcmBase64 = await decodeAudioToPcmBase64(data.audioData);
                    const res = JSON.parse(nativeBridge.asrRecognize(pcmBase64));
                    if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                        displayWs.send(JSON.stringify({
                            type: 'asrResult',
                            requestId: data.requestId,
                            text: res.text || '',
                            error: res.error || ''
                        }));
                    }
                } catch (e) {
                    if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                        displayWs.send(JSON.stringify({
                            type: 'asrResult',
                            requestId: data.requestId,
                            error: e.message,
                            text: ''
                        }));
                    }
                }
                return;
            }

            if (!SherpaASR || !SherpaASR.isLoaded) {
                console.log('[显示端] 收到ASR音频但本地ASR未初始化');
                if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                    displayWs.send(JSON.stringify({
                        type: 'asrResult',
                        requestId: data.requestId,
                        error: '本地ASR未初始化',
                        text: ''
                    }));
                }
                return;
            }

            try {
                const text = await SherpaASR.recognizeBuffer(data.audioData);
                console.log('[显示端] ASR识别结果:', text);

                if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                    displayWs.send(JSON.stringify({
                        type: 'asrResult',
                        requestId: data.requestId,
                        text: text || ''
                    }));
                }
            } catch (e) {
                console.error('[显示端] ASR音频处理失败:', e.message);
                if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                    displayWs.send(JSON.stringify({
                        type: 'asrResult',
                        requestId: data.requestId,
                        error: e.message,
                        text: ''
                    }));
                }
            }
        }

        // webm/wav base64 → 16kHz mono 裸 PCM s16le 的 base64（原生引擎输入契约）
        async function decodeAudioToPcmBase64(base64Audio) {
            const binary = atob(base64Audio);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const decodeCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
            const audioBuffer = await decodeCtx.decodeAudioData(bytes.buffer.slice(0));
            const length = Math.ceil(audioBuffer.duration * 16000);
            const resampleCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, length, 16000);
            const src = resampleCtx.createBufferSource();
            src.buffer = audioBuffer;
            src.connect(resampleCtx.destination);
            src.start();
            const rendered = await resampleCtx.startRendering();
            const samples = rendered.getChannelData(0);
            const pcm = new Uint8Array(samples.length * 2);
            const dv = new DataView(pcm.buffer);
            for (let i = 0; i < samples.length; i++) {
                const s = Math.max(-1, Math.min(1, samples[i]));
                dv.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            }
            let bin = '';
            for (let i = 0; i < pcm.length; i++) bin += String.fromCharCode(pcm[i]);
            return btoa(bin);
        }
```

- [ ] **Step 5: asrConfig 开关映射原生引擎**

将 `asrConfig` 消息处理（约 2441-2451 行）替换为：

```js
                    if (data.type === 'asrConfig') {
                        if (nativeAsrAvailable) {
                            // APK 原生引擎：localAsrEnabled 关闭时把能力声明置 false
                            if (!data.localAsrEnabled && nativeAsrReady) {
                                nativeAsrReady = false;
                                if (displayWs && displayWs.readyState === WebSocket.OPEN && currentCapabilities) {
                                    currentCapabilities.voiceRecognition = false;
                                    displayWs.send(JSON.stringify({ type: 'capabilities', capabilities: currentCapabilities }));
                                }
                            }
                            return;
                        }
                        if (data.localAsrEnabled && !localAsrAvailable) {
                            forceInitLocalAsr();
                        } else if (!data.localAsrEnabled && localAsrAvailable) {
                            if (localAsrStreaming) {
                                SherpaASR.stopStreaming();
                                localAsrStreaming = false;
                            }
                        }
                        return;
                    }
```

- [ ] **Step 6: 真机链路手工验证**

1. 服务器设置 `asr.device=display`（config.json）
2. 安装 APK → 首次开启语音 → 观察顶部"语音模型下载中 N%"上屏 → 完成后"语音识别已就绪"→ `voiceRecognition=true` 上报（服务器日志 `广播 displayList: ... voiceRecognition` 可见）
3. 按住 APK 端说话 → 全链路"录音→上传→中转回本机→原生识别→voiceCommand"出文字上屏
4. 浏览器控制端 chat.js 说话 → 音频中转 APK 原生识别 → 服务器收到文本
5. 对比识别结果与服务器端 SenseVoice 输出一致性
6. 浏览器直接访问 display.html → 仍走 WASM/服务器路径（`nativeAsrAvailable=false`），不受影响

- [ ] **Step 7: 提交**

```bash
git add src/apps/web-mediacenter/ui/public/display.html
git commit -m "feat(display): display.html 接入原生 ASR 路径（能力探测/跳过WASM/handleAsrAudio/进度上屏）"
```

---

### Task 9: 文档同步（spec 伪代码 + changelog + todo + 索引）

**Files:**
- Create: `docs/spec/android-native-asr.md`
- Modify: `docs/spec.md`、`docs/todo.md`、`changelog.md`
- Test: 无（文档审阅）

**Interfaces:**
- Consumes: 前序任务全部完成
- Produces: 符合项目规则的实现文档，spec 伪代码与实际代码同步

- [ ] **Step 1: 写 spec 伪代码文档**

创建 `docs/spec/android-native-asr.md`，结构参照 `docs/spec/android-compute-bridge.md`，内容为：

```markdown
# Android 原生语音识别（sherpa-onnx AAR）实现文档（伪代码）

## 桥接口（window.NativeDisplay）

```
asrStatus() -> String JSON            # {"state":"ready|downloading|not_ready|error","progress":0-100,"error":"..."}
asrEnsureModel() -> String            # "ready" | "downloading" | {"error":"..."}；异步下载经 onNativeAsrModel 回调
asrRecognize(pcmBase64) -> String JSON # 输入裸 PCM(16k mono s16le) base64；返回 {"text":""} 或 {"error":""}；同步阻塞≤20s
window.onNativeAsrModel({state,progress,error})  # 原生→JS：downloading(进度)/ready/error
```

## AsrPcm（纯逻辑，JVM 单测）

```
decodeS16(bytes: ByteArray) -> FloatArray   # s16le → [-1,1] Float32；奇数长度忽略末字节；空输入→空数组
encodeS16(samples: FloatArray) -> ByteArray # Float32 → s16le；越界 clamp[-1,1]
```

## AsrModelFiles（纯逻辑，JVM 单测）

```
MIN_MODEL_SIZE_BYTES = 50MB
needsDownload(model, tokens) -> Boolean  # 缺文件或模型 <50MB（视为损坏）→ true
purge(model, tokens)                     # 删除模型/tokens/.tmp
```

## AsrModelManager（Kotlin 单例）

```
状态机: not_ready → downloading → ready | error
ensureModel(baseUrl, onModelEvent):
  已 ready → return "ready"；已 downloading → return "downloading"
  置 downloading → 后台线程:
    下载 tokens.txt → 下载 model.int8.onnx(进度经 onNativeAsrEvent 上报) → AsrEngine.load()
    成功 → ready；失败 → error + purge(损坏重下)
statusJson(): {"state","progress","error"}
```

## AsrEngine（Kotlin 单例，sherpa-onnx OfflineRecognizer）

```
load(model, tokens) -> Boolean   # 配置同服务器 asr-service.js：SenseVoice auto + itn=1 + numThreads=1 + cpu
recognize(samples: FloatArray) -> String  # createStream → acceptWaveform(samples,16000) → inputFinished → decode → text
```

## NativeBridge（新增 3 方法）

```
asrStatus()             → asrModelManager.statusJson()
asrEnsureModel()        → serverBaseUrl=webView.url 的 origin；asrModelManager.ensureModel{ 事件→主线程 evaluateJavascript onNativeAsrModel }
asrRecognize(pcmBase64) → 未 ready 回 error；Base64.decode→AsrPcm.decodeS16→asrExecutor 串行 AsrEngine.recognize→future.get(20s) 超时回 error
serverBaseUrl()         → Uri.parse(webView.url) 取 scheme://host:port
```

## display.html（接入点）

```
全局: nativeAsrAvailable = !!(window.NativeDisplay?.asrStatus)；nativeAsrReady = false
onNativeAsrModel(payload):
  downloading → updateVoiceTextDisplay("语音模型下载中 N%")
  ready       → nativeAsrReady=true；updateVoiceTextDisplay("语音识别已就绪")；重新上报 capabilities.voiceRecognition=true
  error       → nativeAsrReady=false；提示失败
detectCapabilities.voiceRecognition:
  nativeAsrAvailable → JSON.parse(nativeBridge.asrStatus())；ready→true；not_ready/error→触发 asrEnsureModel() 报 false
checkAsrStatus/initLocalAsr/forceInitLocalAsr: nativeAsrAvailable → 早期 return（不加载 WASM）
startVoiceRecording: 不变（localAsrAvailable=false → MediaRecorder → POST /api/asr/recognize）
handleAsrAudio:
  nativeAsrAvailable:
    未 ready → 触发 ensureModel → 回 asrResult{error:'模型下载中'}
    ready → decodeAudioToPcmBase64(webm→16k mono s16le base64) → asrRecognize → asrResult{text}
  非 APK → SherpaASR.recognizeBuffer WASM（不变）
decodeAudioToPcmBase64: atob → OfflineAudioContext.decodeAudioData → OfflineAudioContext(1,len,16000) 重采样 → Float32→s16le → btoa
asrConfig:
  nativeAsrAvailable → localAsrEnabled=false 时 nativeAsrReady=false + 能力上报 false
  否则 → 原有 WASM 启停逻辑
```

## 服务器（server-app.js）

```
GET /api/asr/model/:filename
  filename ∈ 白名单 {model.int8.onnx, tokens.txt}，否则 400
  ASR_MODEL_DIR = res/models/sensevoice；文件不存在 404
  流式返回 + Content-Length（fs.createReadStream）
```

## 录音（不变）

Manifest 加 RECORD_AUDIO；MainActivity 运行时权限；DisplayWebView.onPermissionRequest 授予 RESOURCE_AUDIO_CAPTURE。
```

- [ ] **Step 2: 更新 spec 索引**

`docs/spec.md` 功能模块表追加一行：

```markdown
| Android 原生语音识别 | [android-native-asr.md](spec/android-native-asr.md) | sherpa-onnx AAR 原生推理、模型按需下载、服务器中转接入 |
```

- [ ] **Step 3: 更新 todo.md**

从 `todo.md` 删除"Android 原生语音识别"任务（若存在），确认无遗留项。

- [ ] **Step 4: 更新 changelog.md**

追加变更记录：

```markdown
## [2026-08-16] Android 原生语音识别（sherpa-onnx AAR）
- 新增：APK 集成 sherpa-onnx Android AAR，原生运行 SenseVoice int8 识别，替代 WASM
- 新增：AsrModelManager 模型按需下载/校验/加载状态机；AsrEngine 封装 OfflineRecognizer
- 新增：NativeBridge 桥方法 asrStatus/asrEnsureModel/asrRecognize + onNativeAsrModel 回调
- 新增：服务器 GET /api/asr/model/<file> 模型下载接口（白名单防路径穿越）
- 新增：display.html 原生 ASR 路径（能力探测/跳过WASM/WebAudio 解码/进度上屏）
- 新增：APK 录音权限 + onPermissionRequest 授权，getUserMedia 可用
- 识别路径：统一服务器中转（asr.device=display 时 asrAudio 回本机原生识别）
```

- [ ] **Step 5: 提交**

```bash
git add docs/spec/android-native-asr.md docs/spec.md docs/todo.md changelog.md
git commit -m "docs: android-native-asr 实现文档 + changelog + todo 更新"
```

---

## 自审

- **Spec 覆盖**：设计文档 6 节全部有对应任务——桥接口（Task 5）、模型管理（Task 3）、引擎封装（Task 4）、权限（Task 6）、display.html 接入（Task 8）、服务器接口（Task 7）；规格伪代码（Task 9）。
- **占位符扫描**：所有代码步骤均给出完整可执行代码；仅 Task 4 的 AAR 构造函数签名标注了"编译时核对"的具名参数调整说明（sherpa-onnx Android 绑定存在版本间参数差异，属合理验证而非占位）。
- **类型一致性**：`AsrPcm.decodeS16`（Task 2）/`AsrModelManager.ensureModel(baseUrl, onModelEvent): String`（Task 3）/`AsrEngine.load: Boolean`、`recognize(FloatArray): String`（Task 4）在 Task 5 与 Task 3 中的调用签名一致；桥方法 JSON 键（state/progress/error/text）在 Task 5 与 Task 8 的 JS 消费侧一致。
