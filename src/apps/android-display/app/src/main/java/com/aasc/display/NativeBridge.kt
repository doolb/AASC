package com.aasc.display

import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import android.app.ActivityManager
import android.os.Build
import android.os.SystemClock
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import com.aasc.display.vision.VisionRuntime

// display.html 的原生桥：截图（真实像素）+ 输入注入（真实触摸/按键，跨域内容可用）
class NativeBridge(
    private val webView: WebView,
    private val audioFocusController: AudioFocusController,
    private val mainHandler: Handler = Handler(Looper.getMainLooper())
) {

    private companion object {
        // ASR/TTS 统一允许最长 60 秒，保证原生桥、声纹分支和服务端等待边界一致。
        const val ASR_TIMEOUT_SECONDS = 60L
        const val TTS_TIMEOUT_SECONDS = 60L
        const val VISION_TIMEOUT_SECONDS = 120L
    }

    // 使用单调时钟计算模型耗时，避免系统时间校准影响结果。
    private fun elapsedMilliseconds(startNanos: Long): Long {
        return TimeUnit.NANOSECONDS.toMillis((System.nanoTime() - startNanos).coerceAtLeast(0L))
    }

    // 由 MainActivity 主线程的页面回调更新；JavaScript bridge 线程只读取该缓存。
    @Volatile
    private var serverOrigin: String = ""

    fun updateServerOrigin(url: String?) {
        serverOrigin = ServerOrigin.fromUrl(url)
    }

    private var lastCpuIdle: Long = -1
    private var lastCpuTotal: Long = -1
    // 回退路径（/proc/self/stat 进程自身 CPU）：utime+stime（jiffy）与采样时刻（elapsedRealtime ms）
    private var lastSelfCpuTime: Long = -1
    private var lastSelfSampleMs: Long = 0

    // 采样整体 CPU（/proc/stat）：返回 (idle, total)，读取失败返回 null
    private fun readOverallCpu(): Pair<Long, Long>? {
        return try {
            RandomAccessFile("/proc/stat", "r").use { raf ->
                val line = raf.readLine() ?: return null
                // "cpu  user nice system idle iowait irq softirq steal ..."
                val parts = line.trim().split(Regex("\\s+"))
                if (parts.size < 5 || parts[0] != "cpu") return null
                var sum = 0L
                for (i in 1 until parts.size) {
                    sum += parts[i].toLongOrNull() ?: 0L
                }
                Pair(parts[4].toLongOrNull() ?: 0L, sum)
            }
        } catch (_: Exception) {
            null
        }
    }

    // 采样进程自身 CPU（/proc/self/stat）：解析 "pid (comm) state ... utime stime ..." 返回 utime+stime（jiffy），失败返回 null
    private fun readSelfCpu(): Long? {
        return try {
            RandomAccessFile("/proc/self/stat", "r").use { raf ->
                val line = raf.readLine() ?: return null
                // comm 可含空格/括号，定位最后一个 ')' 后从 state（字段3）开始
                val closeIdx = line.lastIndexOf(')')
                if (closeIdx < 0) return null
                val rest = line.substring(closeIdx + 1).trim().split(Regex("\\s+"))
                // 字段偏移：rest[0]=字段3(state)，utime=字段14→rest[11]，stime=字段15→rest[12]
                if (rest.size < 13) return null
                val utime = rest[11].toLongOrNull() ?: return null
                val stime = rest[12].toLongOrNull() ?: return null
                utime + stime
            }
        } catch (_: Exception) {
            null
        }
    }

    // 读取 CPU 使用率（%），1 位小数；优先整体 CPU（/proc/stat），SELinux 拒读时回退进程自身（/proc/self/stat）
    private fun readCpuPercent(): Double {
        val overall = readOverallCpu()
        if (overall != null) {
            val idle = overall.first
            val total = overall.second
            if (lastCpuTotal < 0 || lastCpuIdle < 0) {
                lastCpuTotal = total
                lastCpuIdle = idle
                return 0.0 // 首次采样建立基线，返回 0
            }
            val dTotal = total - lastCpuTotal
            val dIdle = idle - lastCpuIdle
            lastCpuTotal = total
            lastCpuIdle = idle
            if (dTotal <= 0) return 0.0
            return (dTotal - dIdle).toDouble() * 100.0 / dTotal
        }
        // 回退：进程自身 CPU 时间（jiffy，Android CLK_TCK=100 → 10ms/jiffy），用真实时间间隔换算百分比
        val nowMs = SystemClock.elapsedRealtime()
        val self = readSelfCpu() ?: return 0.0
        if (lastSelfCpuTime < 0 || lastSelfSampleMs <= 0) {
            lastSelfCpuTime = self
            lastSelfSampleMs = nowMs
            return 0.0 // 首次采样建立基线
        }
        val dSelf = self - lastSelfCpuTime
        val dMs = nowMs - lastSelfSampleMs
        lastSelfCpuTime = self
        lastSelfSampleMs = nowMs
        if (dSelf < 0 || dMs <= 0) return 0.0
        return (dSelf * 10.0 * 100.0) / dMs
    }

    @JavascriptInterface
    fun isAvailable(): Boolean = true

    /** 显示端开始播放视频/音频时申请媒体音频焦点。 */
    @JavascriptInterface
    fun requestAudioFocus(): Boolean = audioFocusController.request()

    /** 显示端进入暂停、睡眠或切换媒体时释放媒体音频焦点。 */
    @JavascriptInterface
    fun abandonAudioFocus() {
        audioFocusController.abandon()
    }

    @JavascriptInterface
    fun getScreenSize(): String {
        val metrics = webView.resources.displayMetrics
        return JSONObject()
            .put("width", metrics.widthPixels)
            .put("height", metrics.heightPixels)
            .toString()
    }

    // ---- ASR 原生识别桥（sherpa-onnx，模型按需下载）----
    private val asrModelManager = AsrModelManager(webView.context)
    // ASR 桥任务允许并发进入 AsrEnginePool；真实并发上限由 pool slot 队列控制，超额任务在池内排队。
    private val asrExecutor = Executors.newCachedThreadPool()
    private val denoiseEngine = SherpaDenoiseEngine()
    private val denoiseModelManager = DenoiseModelManager(webView.context)
    private val denoiseLock = Any()

    // 视觉引擎按首次调用懒加载；状态查询也只创建轻量运行时，不会复制或加载模型。
    private val visionRuntime by lazy { VisionRuntime(webView.context) }

    // ---- 声纹识别桥（speaker identification / 多人分割）----
   private val voiceprintModelManager = VoiceprintModelManager(webView.context)
   private var voiceprintEnabled = false
    private var voiceprintThreshold = 0.3f
    private var voiceprintMultiMode = "fast"
    private var voiceprintSpeakerCount = VoiceprintSpeakerCount.AUTO
    private var asrLanguageMode = AsrLanguageMode.AUTO
    private var asrDenoiseEnabled = false
    // ---- TTS 嵌入式语音合成桥（Microsoft Embedded Speech SDK，模型按需下载）----
    private val ttsModelManager = TtsModelManager(webView.context)
    // TTS 桥侧自身即完成有限准入：worker 数和队列容量都等于当前 policy 的 slotCount。
    // TtsEnginePool 的公平 Semaphore 仍保留，作为进入真实 synthesizer 槽位前的第二层保护。
    private val ttsExecutor = TtsBridgeDispatcher(TtsEngine.currentPolicySlotCount())
    private val ttsExecutorLock = Any()
    private var ttsExecutorSlotCount = TtsEngine.currentPolicySlotCount()
    // LLM 使用独立 affinity policy；不复用 ASR/TTS policy，避免模型推理改变语音线程调度。
    @Volatile
    private var llmCpuPolicy: CpuPolicy? = null
    private val llmModelManager = MnnLlmModelManager(webView.context) {
        llmCpuPolicy ?: CpuCluster.detect().policy(
            bigCoreCount = 2,
            littleCoreCount = 0,
            preferBigCores = true
        )
    }
    // 模型切换、下载、推理队列状态变化都主动通知页面，页面再转发权威状态给服务端。
    init {
        llmModelManager.addStatusListener(::postNativeLlmStatus)
    }
    // 异步桥超时监控不占用 ASR/TTS 推理线程，避免 JavaScript bridge 线程等待 Future。
    private val asyncTimeoutExecutor = Executors.newSingleThreadScheduledExecutor()
    // CPU 配置应用可能触发 ASR/TTS native pool 换代，必须脱离 WebView JavaBridge 线程执行。
    private val cpuConfigExecutor = Executors.newSingleThreadExecutor()
    private val cpuConfigLock = Any()
    private var cpuConfigPending: CpuConfigRequest? = null
    private var cpuConfigRunning = false
    private var cpuConfigLastAppliedKey: String? = null
    private var voiceprintMultiSpeaker = false

    private data class CpuConfigRequest(val key: String, val configJson: String)

    // 同步截图：JS 侧调用即阻塞等待主线程完成 WebView.draw，返回 JSON
    // （JS 函数传 String 参数的回调方式在 WebView 里不可靠，改用同步返回）
    @JavascriptInterface
    fun takeScreenshot(): String {
        val latch = CountDownLatch(1)
        var result = "null"
        mainHandler.post {
            ScreenshotEngine.capture(webView) { dataUrl, w, h ->
                result = if (dataUrl != null)
                    JSONObject()
                        .put("dataUrl", dataUrl)
                        .put("width", w)
                        .put("height", h)
                        .toString()
                else "null"
                latch.countDown()
            }
        }
        return try {
            latch.await(2, TimeUnit.SECONDS)
            result
        } catch (e: InterruptedException) {
            "null"
        }
    }

    @JavascriptInterface
    fun injectTouch(x: Int, y: Int, action: String): Boolean =
        TouchInjector.injectTouch(x, y, action)

    @JavascriptInterface
    fun injectWheel(x: Int, y: Int, deltaY: Int): Boolean =
        TouchInjector.injectWheel(x, y, deltaY)

    @JavascriptInterface
    fun injectKey(keyCode: Int, meta: Int): Boolean =
        KeyInjector.injectKey(webView, keyCode, meta)

    @JavascriptInterface
    fun injectText(text: String): Boolean =
        KeyInjector.injectText(webView, text)

    @JavascriptInterface
    fun getSystemStats(): String {
        val cpuPercent = readCpuPercent()
        val am = webView.context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        val totalBytes = mi.totalMem
        val availBytes = mi.availMem
        val usedBytes = (totalBytes - availBytes).coerceAtLeast(0)
        val gb = 1024.0 * 1024.0 * 1024.0
        val memUsedGb = usedBytes / gb
        val memTotalGb = totalBytes / gb
        val memPercent = if (totalBytes > 0) (usedBytes * 100.0 / totalBytes) else 0.0
        val model = Build.MODEL
        val hostname = if (model.isNotBlank()) model else "${Build.MANUFACTURER} ${Build.MODEL}"
        return JSONObject()
            .put("hostname", hostname)
            .put("cpuPercent", (Math.round(cpuPercent * 10) / 10.0))
            .put("memPercent", (Math.round(memPercent * 10) / 10.0))
            .put("memTotal", (Math.round(memTotalGb * 10) / 10.0))
            .put("memUsed", (Math.round(memUsedGb * 10) / 10.0))
            .toString()
    }

    // GPU compute：JS 传请求 JSON（shader/buffers/images/dispatch），同步返回结果 JSON
    // 解析/验证在 ComputeProtocol（纯逻辑），执行在 ComputeEngine（离屏 EGL 3.1）
    @JavascriptInterface
    fun compute(requestJson: String): String {
        return try {
            val request = ComputeProtocol.parse(requestJson)
            ComputeEngine.execute(request)
        } catch (e: ComputeException) {
            JSONObject().put("error", e.message ?: "compute 参数错误").toString()
        } catch (e: Exception) {
            JSONObject().put("error", "compute 异常: ${e.message}").toString()
        }
    }

    // ---- 正式 APK 原生视觉桥（RapidOCR + YOLO11，默认单小核）----

    /** 返回视觉模型、队列、CPU affinity 和 ORT 线程配置，不触发模型复制或 session 加载。 */
    @JavascriptInterface
    fun visionStatus(): String {
        return try {
            visionRuntime.status().toString()
        } catch (error: Exception) {
            JSONObject().put("ok", false).put("error", error.message ?: "视觉状态读取失败").toString()
        }
    }

    /** 异步提交 OCR 图片；图片结果通过 window.onNativeOcrResult 返回。 */
    @JavascriptInterface
    fun ocrRecognizeAsync(requestId: String, imageBase64: String): String =
        ocrRecognizeScaledAsync(requestId, imageBase64, 0)

    /** 异步提交带短边上限的 OCR 图片；正数只缩小，结果坐标仍对应原图。 */
    @JavascriptInterface
    fun ocrRecognizeScaledAsync(requestId: String, imageBase64: String, shortSide: Int): String =
        submitVisionTask("ocr", requestId, imageBase64) { callback ->
            visionRuntime.submitOcr(requestId, imageBase64, shortSide, serverBaseUrl(), callback)
        }

    /** 异步提交 YOLO11n 图片；图片结果通过 window.onNativeYoloResult 返回。 */
    @JavascriptInterface
    fun yolo11nDetectAsync(requestId: String, imageBase64: String): String =
        submitVisionTask("yolo11n", requestId, imageBase64) { callback ->
            visionRuntime.submitYolo11n(requestId, imageBase64, serverBaseUrl(), "yolo11n", callback)
        }

    /** 异步提交可选 YOLO11 模型；旧 yolo11nDetectAsync 保留给旧网页兼容。 */
    @JavascriptInterface
    fun yoloDetectAsync(requestId: String, imageBase64: String, modelId: String): String =
        submitVisionTask("yolo11n", requestId, imageBase64) { callback ->
            visionRuntime.submitYolo11n(requestId, imageBase64, serverBaseUrl(), modelId, callback)
        }

    private fun submitVisionTask(
        kind: String,
        requestId: String,
        imageBase64: String,
        submit: ((JSONObject) -> Unit) -> JSONObject
    ): String {
        val completed = AtomicBoolean(false)
        return try {
            val accepted = submit { result ->
                if (completed.compareAndSet(false, true)) postNativeVisionResult(kind, result)
            }
            if (!accepted.optBoolean("accepted", false)) return accepted.toString()
            asyncTimeoutExecutor.schedule({
                if (completed.compareAndSet(false, true)) {
                    postNativeVisionResult(kind, com.aasc.display.vision.VisionJson.error(requestId, kind, "视觉推理超时"))
                }
            }, VISION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            accepted.toString()
        } catch (error: Exception) {
            JSONObject().put("accepted", false).put("error", error.message ?: "视觉任务提交失败").toString()
        }
    }

    private fun postNativeVisionResult(kind: String, result: JSONObject) {
        val callbackName = if (kind == "ocr") "onNativeOcrResult" else "onNativeYoloResult"
        val js = "window.$callbackName && window.$callbackName(${result.toString()});"
        mainHandler.post {
            try {
                webView.evaluateJavascript(js, null)
            } catch (_: Exception) {
                // 页面销毁或重载期间回调可能失效，不能让视觉 worker 因此崩溃。
            }
        }
    }

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

    // 保存普通 ASR 的默认处理选项，供旧页面的异步桥和同步兼容入口使用。
    @JavascriptInterface
    fun asrConfigure(languageMode: String, denoise: Boolean): String {
        val parsed = AsrLanguageMode.parse(languageMode)
            ?: return JSONObject().put("ok", false).put("error", "不支持的 ASR 语言").toString()
        asrLanguageMode = parsed
        asrDenoiseEnabled = denoise
        return JSONObject().put("ok", true).toString()
    }

    // 应用服务器下发的 CPU affinity 配置。ASR/TTS 各自使用独立 policy 和独立 pool。
    @JavascriptInterface
    fun cpuConfigure(configJson: String): String {
        return try {
            applyCpuConfig(configJson)
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "CPU 配置异常").toString()
        }
    }

    // 异步应用服务器 CPU affinity 配置：只入队并立即返回，避免阻塞 display.html 的 WebView 主线程。
    // 相同配置直接合并；多个不同配置同时到达时只保留最新待处理配置，后台按顺序安全换代。
    @JavascriptInterface
    fun cpuConfigureAsync(configJson: String): String {
        val key = configJson.trim()
        synchronized(cpuConfigLock) {
            if (key == cpuConfigLastAppliedKey || key == cpuConfigPending?.key) {
                return JSONObject().put("accepted", true).put("coalesced", true).toString()
            }
            cpuConfigPending = CpuConfigRequest(key, configJson)
            if (!cpuConfigRunning) {
                cpuConfigRunning = true
                cpuConfigExecutor.execute { drainCpuConfigQueue() }
            }
        }
        return JSONObject().put("accepted", true).toString()
    }

    // 返回显示端当前实际 CPU 拓扑和 ASR/TTS 生效策略；只读，不触发模型加载或 policy 变更。
    @JavascriptInterface
    fun cpuStatus(): String {
        return try {
            val topology = CpuCluster.detect()
            val effectiveLlmPolicy = llmCpuPolicy ?: topology.policy(
                bigCoreCount = 2,
                littleCoreCount = 0,
                preferBigCores = true
            )
            JSONObject()
                .put("ok", true)
                .put("topology", cpuTopologyJson(topology))
                .put("asr", cpuPolicyJson(AsrEngine.currentPolicy()))
                .put("tts", cpuPolicyJson(TtsEngine.currentPolicy()))
                .put("llm", cpuPolicyJson(effectiveLlmPolicy))
                .toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "CPU 状态读取失败").toString()
        }
    }

    // CPU 配置的实际应用主体运行在专用后台线程；退出临界区后再执行耗时的 native pool 构造。
    private fun drainCpuConfigQueue() {
        while (true) {
            val request = synchronized(cpuConfigLock) {
                val next = cpuConfigPending
                cpuConfigPending = null
                if (next == null) cpuConfigRunning = false
                next
            } ?: return

            val result = try {
                applyCpuConfig(request.configJson)
            } catch (e: Exception) {
                JSONObject().put("error", e.message ?: "CPU 配置异常").toString()
            }
            try {
                val resultJson = JSONObject(result)
                if (resultJson.optBoolean("ok", false)) {
                    synchronized(cpuConfigLock) {
                        cpuConfigLastAppliedKey = request.key
                    }
                    notifyCpuStatusToPage()
                } else {
                    android.util.Log.w("NativeBridge", "异步 CPU 配置失败: ${resultJson.optString("error")}")
                }
            } catch (e: Exception) {
                android.util.Log.w("NativeBridge", "异步 CPU 配置结果解析失败: ${e.message}")
            }
        }
    }

    // CPU 配置在后台线程实际应用完成后主动回调页面，避免页面只读取到旧 policy。
    private fun notifyCpuStatusToPage() {
        val status = cpuStatus()
        mainHandler.post {
            try {
                webView.evaluateJavascript(
                    "window.onNativeCpuStatus && window.onNativeCpuStatus($status);",
                    null
                )
            } catch (e: Exception) {
                android.util.Log.w("NativeBridge", "CPU 状态回调页面失败: ${e.message}")
            }
        }
    }

    // CPU 配置的同步执行主体，仅由兼容同步接口或后台异步 worker 调用。
    private fun applyCpuConfig(configJson: String): String {
        val config = JSONObject(configJson)
        val topology = CpuCluster.detect()
        val asrConfig = config.optJSONObject("asr")
        val ttsConfig = config.optJSONObject("tts")
        val llmConfig = config.optJSONObject("llm")
        val asrPolicy = topology.policy(
            bigCoreCount = readCoreCount(asrConfig, "bigCoreCount"),
            littleCoreCount = readCoreCount(asrConfig, "littleCoreCount"),
            preferBigCores = readPreferBigCores(asrConfig)
        )
        val ttsPolicy = topology.policy(
            bigCoreCount = readCoreCount(ttsConfig, "bigCoreCount"),
            littleCoreCount = readCoreCount(ttsConfig, "littleCoreCount"),
            preferBigCores = readPreferBigCores(ttsConfig)
        )
        val llmPolicy = if (llmConfig != null) {
            topology.policy(
                bigCoreCount = readCoreCount(llmConfig, "bigCoreCount", 2),
                littleCoreCount = readCoreCount(llmConfig, "littleCoreCount", 0),
                preferBigCores = readPreferBigCores(llmConfig, true)
            )
        } else {
            llmCpuPolicy ?: topology.policy(
                bigCoreCount = 2,
                littleCoreCount = 0,
                preferBigCores = true
            )
        }
        if (!AsrEngine.configurePolicy(asrPolicy)) {
            return JSONObject().put("error", "ASR CPU 配置应用失败").toString()
        }
        synchronized(ttsExecutorLock) {
            if (!TtsEngine.configurePolicy(ttsPolicy)) {
                return JSONObject().put("error", "TTS CPU 配置应用失败").toString()
            }
            val slotCount = maxOf(1, ttsPolicy.totalCoreCount)
            if (ttsExecutorSlotCount != slotCount) {
                // 只在 TTS slot 数变化且 policy 成功应用后换代；旧桥任务由旧执行器自然排空。
                ttsExecutor.reconfigure(slotCount)
                ttsExecutorSlotCount = slotCount
            }
        }
        llmCpuPolicy = llmPolicy
        return JSONObject()
            .put("ok", true)
            .put("asr", cpuPolicyJson(asrPolicy))
            .put("tts", cpuPolicyJson(ttsPolicy))
            .put("llm", cpuPolicyJson(llmPolicy))
            .put("topology", cpuTopologyJson(topology))
            .toString()
    }

    // ---- MNN-LLM 本地推理桥：模型下载和推理都在 APK 内完成 ----

    /** 返回本 APK 的 MNN-LLM 状态，不设置也不推断默认模型。 */
    @JavascriptInterface
    fun llmStatus(): String = llmModelManager.status().toJson().toString()

    /** 根据服务端 LLM 能力开关释放或恢复模型运行时；磁盘模型缓存始终保留。 */
    @JavascriptInterface
    fun llmSetEnabled(enabled: Boolean): String {
        return try {
            llmModelManager.setEnabled(serverBaseUrl(), enabled).toString()
        } catch (error: Exception) {
            JSONObject()
                .put("ok", false)
                .put("enabled", enabled)
                .put("error", error.message ?: "LLM 能力状态更新失败")
                .toString()
        }
    }

    /** 选择唯一模型；切换会在当前推理和本地排队任务完成后执行。 */
    @JavascriptInterface
    fun llmSelectModel(modelId: String): String {
        return try {
            val baseUrl = serverBaseUrl()
            if (baseUrl.isBlank()) {
                JSONObject().put("accepted", false).put("error", "无法确定服务器地址").toString()
            } else {
                llmModelManager.selectModel(baseUrl, modelId).toString()
            }
        } catch (error: Exception) {
            JSONObject().put("accepted", false).put("error", error.message ?: "模型选择失败").toString()
        }
    }

    /** 提交服务端转发的 LLM 请求；文本增量和结束事件回到 display.html。 */
    @JavascriptInterface
    fun llmInferAsync(requestId: String, payloadJson: String): String {
        return try {
            val payload = JSONObject(payloadJson)
            llmModelManager.inferAsync(
                requestId = requestId,
                payload = payload,
                onChunk = { text ->
                    postNativeLlmMessage(
                        "onNativeLlmChunk",
                        JSONObject().put("requestId", requestId).put("text", text)
                    )
                },
                onCompleted = { text ->
                    postNativeLlmMessage(
                        "onNativeLlmCompleted",
                        JSONObject().put("requestId", requestId).put("text", text)
                    )
                },
                onError = { code, message ->
                    postNativeLlmMessage(
                        "onNativeLlmError",
                        JSONObject().put("requestId", requestId)
                            .put("code", code)
                            .put("message", message)
                    )
                }
            ).toString()
        } catch (error: Exception) {
            JSONObject().put("accepted", false).put("error", error.message ?: "LLM 请求提交失败").toString()
        }
    }

    /** 取消请求；官方 LlmSession 当前只提供安全停止回调的兼容入口。 */
    @JavascriptInterface
    fun llmCancel(requestId: String): Boolean = llmModelManager.cancel(requestId)

    private fun postNativeLlmStatus(status: MnnLlmStatus) {
        postNativeLlmMessage("onNativeLlmStatus", status.toJson())
    }

    private fun postNativeLlmMessage(callbackName: String, payload: JSONObject) {
        val js = "window.$callbackName && window.$callbackName(${payload});"
        mainHandler.post {
            try {
                webView.evaluateJavascript(js, null)
            } catch (error: Exception) {
                android.util.Log.w("NativeBridge", "LLM 页面回调失败: ${error.message}")
            }
        }
    }

    // 一次性识别：输入裸 PCM（16kHz mono s16le）的 base64，同步返回 {"text":"..."} 或 {"error":"..."}
    // ASR 桥任务可并发提交到 cached executor，真实推理并发由 AsrEnginePool 槽位限制；桥调用最多等待 60 秒。
    @JavascriptInterface
   fun asrRecognize(pcmBase64: String): String {
        return try {
            if (!asrModelManager.isReady) {
                return JSONObject().put("error", "模型未就绪").toString()
            }
            val bytes = Base64.decode(pcmBase64, Base64.DEFAULT)
            val samples = AsrPcm.decodeS16(bytes)
            val result = asrExecutor.submit {
                val prepared = prepareAudio(samples, asrDenoiseEnabled)
                val asrStartedAt = System.nanoTime()
                val text = recognizeText(prepared.samples, asrLanguageMode)
                JSONObject()
                    .put("text", text)
                    .put("asrElapsedMs", elapsedMilliseconds(asrStartedAt))
                    .put("voiceprintElapsedMs", JSONObject.NULL)
            }.get(ASR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            result.toString()
        } catch (e: java.util.concurrent.TimeoutException) {
            JSONObject().put("error", "识别超时").toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "识别失败").toString()
       }
   }

    // 异步 ASR：JavaScript bridge 线程只负责入队，识别结果通过主线程回调 window.onNativeAsrResult。
    @JavascriptInterface
    fun asrRecognizeAsync(
        requestId: String,
        pcmBase64: String,
        useVoiceprint: Boolean,
        multiSpeaker: Boolean
    ): String {
        return submitAsrTask(
            requestId,
            pcmBase64,
            useVoiceprint,
            multiSpeaker,
            asrDenoiseEnabled,
            asrLanguageMode.queryValue,
            voiceprintMultiMode,
            voiceprintSpeakerCount
        )
    }

    // 新版异步桥：扩展降噪、语言和快速多人参数；保留上面的四参数入口兼容旧页面。
    @JavascriptInterface
    fun asrRecognizeAsyncWithOptions(
        requestId: String,
        pcmBase64: String,
        useVoiceprint: Boolean,
        multiSpeaker: Boolean,
        denoise: Boolean,
        languageMode: String,
        multiMode: String,
        speakerCount: String
    ): String = submitAsrTask(
        requestId,
        pcmBase64,
        useVoiceprint,
        multiSpeaker,
        denoise,
        languageMode,
        multiMode,
        VoiceprintSpeakerCount.parse(speakerCount) ?: VoiceprintSpeakerCount.AUTO
    )

    private fun submitAsrTask(
        requestId: String,
        pcmBase64: String,
        useVoiceprint: Boolean,
        multiSpeaker: Boolean,
        denoise: Boolean,
        languageValue: String,
        multiMode: String,
        speakerCount: Int
    ): String {
        if (!asrModelManager.isReady) {
            return JSONObject().put("accepted", false).put("error", "模型未就绪").toString()
        }

        val completed = AtomicBoolean(false)
        try {
            lateinit var future: Future<*>
            future = asrExecutor.submit {
                val result = try {
                    val bytes = Base64.decode(pcmBase64, Base64.DEFAULT)
                    val samples = AsrPcm.decodeS16(bytes)
                    recognizeAsyncPayload(samples, useVoiceprint, multiSpeaker, denoise, languageValue, multiMode, speakerCount)
                } catch (e: Exception) {
                    JSONObject().put("error", e.message ?: "识别失败")
                }
                if (completed.compareAndSet(false, true)) {
                    postNativeAsrResult(requestId, result)
                }
            }
            asyncTimeoutExecutor.schedule({
                if (completed.compareAndSet(false, true)) {
                    future.cancel(true)
                    postNativeAsrResult(requestId, JSONObject().put("error", "识别超时"))
                }
            }, ASR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            return JSONObject().put("accepted", true).toString()
        } catch (e: Exception) {
            return JSONObject().put("accepted", false).put("error", e.message ?: "识别任务提交失败").toString()
        }
    }

    // 原生 ASR/声纹统一结果，避免 display.html 为声纹分支重新同步调用多个桥方法。
    private fun recognizeAsyncPayload(
        samples: FloatArray,
        useVoiceprint: Boolean,
        multiSpeaker: Boolean,
        denoise: Boolean,
        languageValue: String,
        multiMode: String,
        speakerCount: Int
    ): JSONObject {
        val languageMode = AsrLanguageMode.parse(languageValue) ?: AsrLanguageMode.AUTO
        val prepared = prepareAudio(samples, denoise)
        val preparedSamples = prepared.samples
        if (!useVoiceprint || !voiceprintEnabled || !voiceprintModelManager.isReady || !VoiceprintEngine.ready) {
            val asrStartedAt = System.nanoTime()
            val text = recognizeText(preparedSamples, languageMode)
            return JSONObject()
                .put("text", text)
                .put("asrElapsedMs", elapsedMilliseconds(asrStartedAt))
                .put("voiceprintElapsedMs", JSONObject.NULL)
                .put("denoise", prepared.enabled)
                .put("languageMode", languageMode.queryValue)
        }
        if (multiSpeaker) {
            if (preparedSamples.isEmpty()) return JSONObject().put("error", "音频数据为空")
            if (multiMode != "fast") return JSONObject().put("error", "正式 APK 只支持快速多段模式")
            if (speakerCount !in VoiceprintSpeakerCount.AUTO..VoiceprintSpeakerCount.MAX) {
                return JSONObject().put("error", "speakerCount 必须是 AUTO 或 1-5")
            }
            val voiceprintStartedAt = System.nanoTime()
            val segments = VoiceprintEngine.diarize(preparedSamples, speakerCount)
            val indexMergedSegments = VoiceprintSegmentMerger.merge(segments.map { seg ->
                VoiceprintSegmentMerger.DiarizedSegment(seg.start, seg.end, seg.speakerIndex)
            })
            val matchedSegments = matchFastVoiceprintSegments(preparedSamples, indexMergedSegments)
            val resolvedSegments = VoiceprintSegmentPostProcessor.resolve(matchedSegments) { start, end, clusterId ->
                matchVoiceprintSegment(
                    preparedSamples,
                    VoiceprintSegmentMerger.MergedSegment(start, end, clusterId)
                )
            }
            val voiceprintElapsedMs = elapsedMilliseconds(voiceprintStartedAt)
            var asrElapsedMs = 0L
            val arr = org.json.JSONArray()
            for (seg in resolvedSegments) {
                val segmentSamples = sliceSamples(preparedSamples, seg.start, seg.end)
                val text = if (segmentSamples.size >= 1600) {
                    val asrStartedAt = System.nanoTime()
                    val recognizedText = recognizeText(segmentSamples, languageMode)
                    asrElapsedMs += elapsedMilliseconds(asrStartedAt)
                    recognizedText
                } else ""
                arr.put(JSONObject()
                    .put("start", seg.start.toDouble())
                    .put("end", seg.end.toDouble())
                    .put("text", text)
                    .put("speaker", seg.match.speaker ?: JSONObject.NULL)
                    .put("similarityScore", seg.match.similarityScore ?: JSONObject.NULL)
                    .put("threshold", seg.match.threshold)
                    .put("error", seg.error ?: JSONObject.NULL))
            }
            return JSONObject()
                .put("segments", arr)
                .put("asrElapsedMs", asrElapsedMs)
                .put("voiceprintElapsedMs", voiceprintElapsedMs)
                .put("threshold", VoiceprintEngine.matchThreshold)
                .put("denoise", prepared.enabled)
                .put("languageMode", languageMode.queryValue)
                .put("multiMode", multiMode)
                .put("speakerCount", speakerCount)
        }
        val asrStartedAt = System.nanoTime()
        val text = recognizeText(preparedSamples, languageMode)
        val asrElapsedMs = elapsedMilliseconds(asrStartedAt)
        val voiceprintStartedAt = System.nanoTime()
        val embedding = VoiceprintEngine.extract(preparedSamples)
        val match = VoiceprintEngine.match(embedding)
        val voiceprintElapsedMs = elapsedMilliseconds(voiceprintStartedAt)
        return JSONObject()
            .put("text", text)
            .put("asrElapsedMs", asrElapsedMs)
            .put("voiceprintElapsedMs", voiceprintElapsedMs)
            .put("speaker", match.speaker ?: JSONObject.NULL)
            .put("similarityScore", match.similarityScore ?: JSONObject.NULL)
            .put("threshold", match.threshold)
            .put("dim", VoiceprintEngine.dim)
            .put("denoise", prepared.enabled)
            .put("languageMode", languageMode.queryValue)
    }

    private fun prepareAudio(samples: FloatArray, enabled: Boolean): PreparedDenoiseAudio =
        DenoiseAudioPolicy.prepare(samples, enabled) {
            synchronized(denoiseLock) {
                val install = denoiseModelManager.ensureModel(serverBaseUrl())
                if (install.changed || !denoiseEngine.isLoaded) {
                    var loaded = denoiseEngine.load(install.file(DenoiseModelFiles.FILE_NAME))
                    val newInstallAccepted = install.changed && loaded
                    if (!loaded && install.changed) {
                        val restored = denoiseModelManager.rollbackInstall(install)
                        loaded = restored != null && denoiseEngine.load(restored.file(DenoiseModelFiles.FILE_NAME))
                    }
                    check(loaded) { "降噪模型加载失败" }
                    if (newInstallAccepted) denoiseModelManager.finalizeInstall(install)
                }
                denoiseEngine.process(samples)
            }
        }

    private fun recognizeText(samples: FloatArray, languageMode: AsrLanguageMode): String =
        AsrEngine.recognize(samples, languageMode)

    // 快速多人模式只对每个 cluster 的最长区间提取一次声纹，随后把同一 cluster 的结果复制到全部原始区间。
    // 保护性合并触发时，VoiceprintSegmentPostProcessor 会重新提取完整候选区间。
    private fun matchFastVoiceprintSegments(
        samples: FloatArray,
        segments: List<VoiceprintSegmentMerger.MergedSegment>
    ): List<VoiceprintSegmentPostProcessor.MatchedSegment> {
        val matchByCluster = VoiceprintFastPath.representatives(segments).associate { representative ->
            representative.speakerIndex to matchVoiceprintSegment(samples, representative)
        }
        return segments.map { segment ->
            val representative = matchByCluster[segment.speakerIndex]
            if (representative != null) {
                representative.copy(
                    start = segment.start,
                    end = segment.end,
                    clusterId = segment.speakerIndex
                )
            } else {
                matchVoiceprintSegment(samples, segment)
            }
        }
    }

    // 对指定原始时间区间执行一次 embedding 提取和声纹匹配；失败时保留区间并返回可序列化错误。
    private fun matchVoiceprintSegment(
        samples: FloatArray,
        segment: VoiceprintSegmentMerger.MergedSegment
    ): VoiceprintSegmentPostProcessor.MatchedSegment {
        return try {
            val segmentSamples = sliceSamples(samples, segment.start, segment.end)
            val embedding = VoiceprintEngine.extract(segmentSamples)
            VoiceprintSegmentPostProcessor.MatchedSegment(
                start = segment.start,
                end = segment.end,
                clusterId = segment.speakerIndex,
                match = VoiceprintEngine.match(embedding)
            )
        } catch (e: Exception) {
            VoiceprintSegmentPostProcessor.MatchedSegment(
                start = segment.start,
                end = segment.end,
                clusterId = segment.speakerIndex,
                match = VoiceprintMatchResult(null, null, VoiceprintEngine.matchThreshold),
                error = e.message ?: "声纹提取失败"
            )
        }
    }

    private fun sliceSamples(samples: FloatArray, start: Float, end: Float): FloatArray {
        if (samples.isEmpty()) return FloatArray(0)
        val startIndex = (start * 16000).toInt().coerceIn(0, samples.size - 1)
        val endIndex = (end * 16000).toInt().coerceIn(startIndex + 1, samples.size)
        return samples.copyOfRange(startIndex, endIndex)
    }

    private fun postNativeAsrResult(requestId: String, result: JSONObject) {
        result.put("requestId", requestId)
        val js = "window.onNativeAsrResult && window.onNativeAsrResult(${result.toString()});"
        mainHandler.post {
            try {
                webView.evaluateJavascript(js, null)
            } catch (_: Exception) {
                // 页面销毁或重载期间回调可能失效，不能让原生工作线程因此崩溃。
            }
        }
    }

    private fun readCoreCount(config: JSONObject?, fieldName: String, defaultCount: Int = 1): Int {
        val raw = config?.opt(fieldName)
        return when (raw) {
            is Number -> raw.toInt().coerceAtLeast(0)
            else -> defaultCount
        }
    }

    private fun readPreferBigCores(config: JSONObject?, defaultValue: Boolean = false): Boolean {
        return config?.optBoolean("preferBigCores", defaultValue) ?: defaultValue
    }

    private fun cpuPolicyJson(policy: CpuPolicy): JSONObject {
        return JSONObject()
            .put("bigCpus", intListJson(policy.bigCpus))
            .put("littleCpus", intListJson(policy.littleCpus))
            .put("selectedCpus", intListJson(policy.selectedCpus))
            .put("cpuMask", policy.cpuMask)
            .put("effectiveBigCoreCount", policy.effectiveBigCoreCount)
            .put("effectiveLittleCoreCount", policy.effectiveLittleCoreCount)
            .put("totalCoreCount", policy.totalCoreCount)
            // LLM 将该值作为 MNN native 的显式 thread_num；其他能力保留同一策略结构。
            .put("threadCount", policy.totalCoreCount.coerceAtLeast(1))
            .put("fallback", policy.fallback)
            .put("fallbackReason", policy.fallbackReason ?: JSONObject.NULL)
    }

    private fun cpuTopologyJson(topology: CpuTopology): JSONObject {
        return JSONObject()
            .put("bigCpus", intListJson(topology.bigCpus))
            .put("littleCpus", intListJson(topology.littleCpus))
            .put("fallback", topology.fallback)
            .put("fallbackReason", topology.fallbackReason ?: JSONObject.NULL)
    }

    private fun intListJson(values: List<Int>): org.json.JSONArray {
        val arr = org.json.JSONArray()
        for (value in values) arr.put(value)
        return arr
    }

   // 查询声纹引擎状态：{"ready":true|false,"dim":512,"speakers":["妲己"]}（dim 由模型决定，eres2net 为 512）
    // ---- TTS 嵌入式语音合成桥接口 ----

    // 查询原生 TTS 引擎状态：{"state":"ready|downloading|not_ready|error","progress":0-100,"error":"..."}
    @JavascriptInterface
    fun ttsStatus(): String {
        return ttsModelManager.statusJson().toString()
    }

    // 触发 TTS 模型下载+加载（幂等）。就绪返回 "ready"，下载中/刚触发返回 "downloading"
    // 进度与结果通过 window.onNativeTtsModel 回调（主线程 evaluateJavascript）
    @JavascriptInterface
    fun ttsEnsureModel(): String {
        val baseUrl = serverBaseUrl()
        if (baseUrl.isEmpty()) return JSONObject().put("error", "无法确定服务器地址").toString()
        return ttsModelManager.ensureModel(baseUrl) { event ->
            val js = "window.onNativeTtsModel && window.onNativeTtsModel(${event.toString()});"
            webView.evaluateJavascript(js, null)
        }
    }

    // 离线合成文本为 WAV：输入文本，同步返回 {"audio":"<base64 wav>"} 或 {"error":"..."}
    // TTS 桥任务提交到有界 executor，真实推理由 TtsEnginePool 槽位限制；桥调用最多等待 60 秒。
    @JavascriptInterface
    fun ttsSynthesize(text: String): String {
        var future: Future<ByteArray>? = null
        return try {
            if (!ttsModelManager.isReady) {
                return JSONObject().put("error", "模型未就绪").toString()
            }
            future = synchronized(ttsExecutorLock) {
                ttsExecutor.submit(Callable<ByteArray> {
                    TtsEngine.synthesize(text)
                })
            }
            val audio = future.get(TTS_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            JSONObject().put("audio", Base64.encodeToString(audio, Base64.NO_WRAP)).toString()
        } catch (e: java.util.concurrent.TimeoutException) {
            // 超时后尽量中断仍停留在 admission/idle slot 等待中的桥任务，避免无意义占用。
            // 已进入原生合成的 slot 会自行等到底层调用完成后再归还，不会并发复用 synthesizer。
            future?.cancel(true)
            JSONObject().put("error", "合成超时").toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "合成失败").toString()
        }
    }

    // 异步 TTS：JavaScript bridge 线程立即返回，生成结果通过主线程回调 window.onNativeTtsResult。
    @JavascriptInterface
    fun ttsSynthesizeAsync(requestId: String, text: String): String {
        if (!ttsModelManager.isReady) {
            return JSONObject().put("accepted", false).put("error", "模型未就绪").toString()
        }

        val completed = AtomicBoolean(false)
        try {
            lateinit var future: Future<*>
            future = synchronized(ttsExecutorLock) {
                ttsExecutor.submit(Callable {
                    val result = try {
                        val audio = TtsEngine.synthesize(text)
                        JSONObject().put("audio", Base64.encodeToString(audio, Base64.NO_WRAP))
                    } catch (e: Exception) {
                        JSONObject().put("error", e.message ?: "合成失败")
                    }
                    if (completed.compareAndSet(false, true)) {
                        postNativeTtsResult(requestId, result)
                    }
                })
            }
            asyncTimeoutExecutor.schedule({
                if (completed.compareAndSet(false, true)) {
                    future.cancel(true)
                    postNativeTtsResult(requestId, JSONObject().put("error", "合成超时"))
                }
            }, TTS_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            return JSONObject().put("accepted", true).toString()
        } catch (e: Exception) {
            return JSONObject().put("accepted", false).put("error", e.message ?: "合成任务提交失败").toString()
        }
    }

    private fun postNativeTtsResult(requestId: String, result: JSONObject) {
        result.put("requestId", requestId)
        val js = "window.onNativeTtsResult && window.onNativeTtsResult(${result.toString()});"
        mainHandler.post {
            try {
                webView.evaluateJavascript(js, null)
            } catch (_: Exception) {
                // 页面销毁或重载期间回调可能失效，不能让原生工作线程因此崩溃。
            }
        }
    }

   @JavascriptInterface
   fun voiceprintStatus(): String {
        return try {
            JSONObject()
                .put("ready", VoiceprintEngine.ready)
                .put("dim", VoiceprintEngine.dim)
                .put("speakers", VoiceprintEngine.speakers)
                .put("threshold", VoiceprintEngine.matchThreshold)
                .toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "声纹状态异常").toString()
        }
    }

    // 配置声纹引擎：{"enabled":bool,"threshold":0.3,"multiSpeaker":bool}；触发模型下载+引擎加载
    // 结果经 window.onVoiceprintModel 回调（downloading/ready/error）
    @JavascriptInterface
    fun voiceprintConfigure(configJson: String): String {
        return try {
            val cfg = org.json.JSONObject(configJson)
            val configuredThreshold = cfg.optDouble("threshold", 0.3).toFloat()
            if (!configuredThreshold.isFinite() || configuredThreshold <= 0f || configuredThreshold > 1f) {
                return JSONObject().put("error", "threshold 必须是 (0,1] 的数值").toString()
            }
            voiceprintEnabled = cfg.optBoolean("enabled", true)
            voiceprintThreshold = configuredThreshold
            voiceprintMultiSpeaker = cfg.optBoolean("multiSpeaker", true)
            voiceprintMultiMode = cfg.optString("multiMode", "fast").lowercase()
            voiceprintSpeakerCount = VoiceprintSpeakerCount.parse(cfg.optString("speakerCount", "AUTO"))
                ?: return JSONObject().put("error", "speakerCount 必须是 AUTO 或 1-5").toString()
            if (voiceprintMultiMode != "fast") {
                return JSONObject().put("error", "正式 APK 只支持快速多段模式").toString()
            }
            if (!voiceprintEnabled) return JSONObject().put("ok", true).toString()
            val baseUrl = serverBaseUrl()
            if (baseUrl.isEmpty()) return JSONObject().put("error", "无法确定服务器地址").toString()
            // 模型已就绪时 ensureModel 短路返回 "ready" 且不回调事件，需立即应用配置；
            // 仅在确实短路（返回 "ready"）时才立即 load，避免与补下载 segmentation 的路径重复加载
            val ensureResult = voiceprintModelManager.ensureModel(baseUrl, voiceprintMultiSpeaker) { event ->
                if (event.optString("state") == "ready") {
                    val loaded = VoiceprintEngine.load(
                        webView.context, voiceprintModelManager.embeddingModelPath,
                        if (voiceprintMultiSpeaker) voiceprintModelManager.segmentationModelPath else null,
                        voiceprintThreshold, voiceprintMultiSpeaker, voiceprintMultiMode, voiceprintSpeakerCount)
                    event.put("engineReady", loaded)
                }
                val js = "window.onVoiceprintModel && window.onVoiceprintModel(${event.toString()});"
                mainHandler.post {
                    try {
                        webView.evaluateJavascript(js, null)
                    } catch (_: Exception) {
                        // 页面销毁或重载期间回调可能失效，不能让模型任务线程崩溃。
                    }
                }
            }
            if (ensureResult == "ready") {
                // 应用配置（threshold/multiSpeaker），此时 embedding 与 segmentation 均已就绪
                val loaded = VoiceprintEngine.load(
                    webView.context, voiceprintModelManager.embeddingModelPath,
                    if (voiceprintMultiSpeaker) voiceprintModelManager.segmentationModelPath else null,
                    voiceprintThreshold, voiceprintMultiSpeaker, voiceprintMultiMode, voiceprintSpeakerCount)
                val js = "window.onVoiceprintModel && window.onVoiceprintModel(${JSONObject().put("state","ready").put("engineReady",loaded)});"
                mainHandler.post {
                    try {
                        webView.evaluateJavascript(js, null)
                    } catch (_: Exception) {
                        // 页面销毁或重载期间回调可能失效，不能让 JavaBridge 线程崩溃。
                    }
                }
            }
            JSONObject().put("ok", true).toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "声纹配置异常").toString()
        }
    }

    // 单段声纹匹配：裸 PCM base64 → {"speaker":人名|null,"similarityScore":数值|null,"threshold":数值} 或 {"error":"..."}
    @JavascriptInterface
    fun voiceprintMatch(pcmBase64: String): String {
        return try {
            if (!voiceprintEnabled || !voiceprintModelManager.isReady || !VoiceprintEngine.ready) {
                return JSONObject().put("error", "模型未就绪").toString()
            }
            val bytes = Base64.decode(pcmBase64, Base64.DEFAULT)
            val samples = AsrPcm.decodeS16(bytes)
            val voiceprintStartedAt = System.nanoTime()
            val embedding = asrExecutor.submit<FloatArray> { VoiceprintEngine.extract(samples) }.get(ASR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            val match = VoiceprintEngine.match(embedding)
            val voiceprintElapsedMs = elapsedMilliseconds(voiceprintStartedAt)
            JSONObject()
                .put("speaker", match.speaker ?: JSONObject.NULL)
                .put("similarityScore", match.similarityScore ?: JSONObject.NULL)
                .put("threshold", match.threshold)
                .put("dim", VoiceprintEngine.dim)
                .put("voiceprintElapsedMs", voiceprintElapsedMs)
                .toString()
        } catch (e: java.util.concurrent.TimeoutException) {
            JSONObject().put("error", "声纹识别超时").toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "声纹识别失败").toString()
        }
    }

    // 多人分割+声纹匹配+保护性后处理+识别：裸 PCM base64 → {"segments":[...]} 或 {"error":"..."}
    @JavascriptInterface
    fun voiceprintDiarize(pcmBase64: String): String {
        return try {
            if (!voiceprintEnabled || !voiceprintModelManager.isReady || !VoiceprintEngine.ready || !asrModelManager.isReady) {
                return JSONObject().put("error", "模型未就绪").toString()
            }
            val bytes = Base64.decode(pcmBase64, Base64.DEFAULT)
            val samples = AsrPcm.decodeS16(bytes)
            if (samples.isEmpty()) {
                return JSONObject().put("error", "音频数据为空").toString()
            }
            val result = asrExecutor.submit<JSONObject> {
                val voiceprintStartedAt = System.nanoTime()
                val segments = VoiceprintEngine.diarize(samples)
                val indexMergedSegments = VoiceprintSegmentMerger.merge(segments.map { seg ->
                    VoiceprintSegmentMerger.DiarizedSegment(seg.start, seg.end, seg.speakerIndex)
                })
                val matchedSegments = matchFastVoiceprintSegments(samples, indexMergedSegments)
                val resolvedSegments = VoiceprintSegmentPostProcessor.resolve(matchedSegments) { start, end, clusterId ->
                    matchVoiceprintSegment(
                        samples,
                        VoiceprintSegmentMerger.MergedSegment(start, end, clusterId)
                    )
                }
                val voiceprintElapsedMs = elapsedMilliseconds(voiceprintStartedAt)
                var asrElapsedMs = 0L
                val arr = org.json.JSONArray()
                for (seg in resolvedSegments) {
                    val mergedSamples = sliceSamples(samples, seg.start, seg.end)
                    val text = if (mergedSamples.size >= 1600) {
                        val asrStartedAt = System.nanoTime()
                        val recognizedText = AsrEngine.recognize(mergedSamples)
                        asrElapsedMs += elapsedMilliseconds(asrStartedAt)
                        recognizedText
                    } else ""
                    arr.put(org.json.JSONObject()
                        .put("start", seg.start.toDouble())
                        .put("end", seg.end.toDouble())
                        .put("text", text)
                        .put("speaker", seg.match.speaker ?: JSONObject.NULL)
                        .put("similarityScore", seg.match.similarityScore ?: JSONObject.NULL)
                        .put("threshold", seg.match.threshold)
                        .put("error", seg.error ?: JSONObject.NULL))
                }
                JSONObject()
                    .put("segments", arr)
                    .put("asrElapsedMs", asrElapsedMs)
                    .put("voiceprintElapsedMs", voiceprintElapsedMs)
            }.get(ASR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            result
                .put("threshold", VoiceprintEngine.matchThreshold)
                .toString()
        } catch (e: java.util.concurrent.TimeoutException) {
            JSONObject().put("error", "多人分割超时").toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "多人分割失败").toString()
        }
    }

    // 声纹特征提取（register display 模式中转用）：裸 PCM base64 → {"dim":512,"embedding":[...]} 或 {"error":"..."}（dim 由模型决定，eres2net 为 512）
    @JavascriptInterface
    fun voiceprintExtract(pcmBase64: String): String {
        return try {
            if (!voiceprintModelManager.isReady || !VoiceprintEngine.ready) {
                return JSONObject().put("error", "模型未就绪").toString()
            }
            val bytes = Base64.decode(pcmBase64, Base64.DEFAULT)
            val samples = AsrPcm.decodeS16(bytes)
            val embedding = asrExecutor.submit<FloatArray> { VoiceprintEngine.extract(samples) }.get(ASR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            val arr = org.json.JSONArray()
            for (v in embedding) arr.put(v.toDouble())
            JSONObject().put("dim", embedding.size).put("embedding", arr).toString()
        } catch (e: java.util.concurrent.TimeoutException) {
            JSONObject().put("error", "声纹提取超时").toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "声纹提取失败").toString()
        }
    }

    // 重建本地声纹库（幂等）：display.html 已用 fetch 拉取权威库 JSON（WebView 信任自签名证书），
    // Kotlin 侧只负责解析+重建；结果触发 window.onVoiceprintDb。
    // @JavascriptInterface 方法在 JavaBridge 后台线程执行，evaluateJavascript 必须在 UI 线程调用，
    // 故成功/失败两路回调都经 mainHandler.post 投递到主线程；回调传入对象字面量，JSONObject 已按 JSON 规则转义所有字符串，
    // 对 JS 注入安全（speakers 名称为用户可控）。
    @JavascriptInterface
    fun voiceprintSyncDb(dbJson: String): String {
        return try {
            val db = org.json.JSONObject(dbJson)
            val speakers = VoiceprintDbCodec.speakersFromDb(db)
            VoiceprintEngine.setDb(speakers)
            val msg = JSONObject().put("state", "ready").put("speakers", speakers.keys.toList())
            val js = "window.onVoiceprintDb && window.onVoiceprintDb(${msg.toString()});"
            mainHandler.post { webView.evaluateJavascript(js, null) }
            JSONObject().put("ok", true).toString()
        } catch (e: Exception) {
            val msg = JSONObject().put("state", "error").put("error", e.message ?: "声纹库同步失败")
            val js = "window.onVoiceprintDb && window.onVoiceprintDb(${msg.toString()});"
            mainHandler.post { webView.evaluateJavascript(js, null) }
            JSONObject().put("error", e.message ?: "声纹库同步失败").toString()
        }
    }

    // 返回主线程缓存的服务器 origin（模型下载地址基准）。
    // 不能在 JavaBridge 线程读取 webView.url，否则会触发 WebView 跨线程访问并可能得到空地址。
    private fun serverBaseUrl(): String {
        return serverOrigin
    }
}
