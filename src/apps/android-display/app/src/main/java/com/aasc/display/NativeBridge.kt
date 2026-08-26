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
import java.io.RandomAccessFile
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

// display.html 的原生桥：截图（真实像素）+ 输入注入（真实触摸/按键，跨域内容可用）
class NativeBridge(
    private val webView: WebView,
    private val mainHandler: Handler = Handler(Looper.getMainLooper())
) {

    private companion object {
        // ASR/TTS 统一允许最长 60 秒，保证原生桥、声纹分支和服务端等待边界一致。
        const val ASR_TIMEOUT_SECONDS = 60L
        const val TTS_TIMEOUT_SECONDS = 60L
    }

    // 音频焦点变化回调必须切回 WebView 主线程，避免从 AudioManager 回调线程直接执行 JS。
    private val audioFocusController = AudioFocusController(webView.context) { change ->
        mainHandler.post {
            webView.evaluateJavascript(
                "window.onNativeAudioFocusChanged && window.onNativeAudioFocusChanged($change);",
                null
            )
        }
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

    // ---- 声纹识别桥（speaker identification / 多人分割）----
   private val voiceprintModelManager = VoiceprintModelManager(webView.context)
   private var voiceprintEnabled = false
   private var voiceprintThreshold = 0.5f
    // ---- TTS 嵌入式语音合成桥（Microsoft Embedded Speech SDK，模型按需下载）----
    private val ttsModelManager = TtsModelManager(webView.context)
    // TTS 桥侧自身即完成有限准入：worker 数和队列容量都等于当前 policy 的 slotCount。
    // TtsEnginePool 的公平 Semaphore 仍保留，作为进入真实 synthesizer 槽位前的第二层保护。
    private val ttsExecutor = TtsBridgeDispatcher(TtsEngine.currentPolicySlotCount())
    private val ttsExecutorLock = Any()
    // 异步桥超时监控不占用 ASR/TTS 推理线程，避免 JavaScript bridge 线程等待 Future。
    private val asyncTimeoutExecutor = Executors.newSingleThreadScheduledExecutor()
    private var voiceprintMultiSpeaker = false

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

    // 应用服务器下发的 CPU affinity 配置。ASR/TTS 各自使用独立 policy 和独立 pool。
    @JavascriptInterface
    fun cpuConfigure(configJson: String): String {
        return try {
            val config = JSONObject(configJson)
            val topology = CpuCluster.detect()
            val asrConfig = config.optJSONObject("asr")
            val ttsConfig = config.optJSONObject("tts")
            val asrPolicy = topology.policy(
                bigCoreCount = readCoreCount(asrConfig, "bigCoreCount"),
                littleCoreCount = readCoreCount(asrConfig, "littleCoreCount")
            )
            val ttsPolicy = topology.policy(
                bigCoreCount = readCoreCount(ttsConfig, "bigCoreCount"),
                littleCoreCount = readCoreCount(ttsConfig, "littleCoreCount")
            )
            if (!AsrEngine.configurePolicy(asrPolicy)) {
                return JSONObject().put("error", "ASR CPU 配置应用失败").toString()
            }
            synchronized(ttsExecutorLock) {
                if (!TtsEngine.configurePolicy(ttsPolicy)) {
                    return JSONObject().put("error", "TTS CPU 配置应用失败").toString()
                }
                // 只在 TTS policy 成功应用后换代；旧桥任务由旧执行器自然排空，不中断活动合成。
                ttsExecutor.reconfigure(maxOf(1, ttsPolicy.totalCoreCount))
            }
            JSONObject()
                .put("ok", true)
                .put("asr", cpuPolicyJson(asrPolicy))
                .put("tts", cpuPolicyJson(ttsPolicy))
                .put("topology", cpuTopologyJson(topology))
                .toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "CPU 配置异常").toString()
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
            val text = asrExecutor.submit {
                AsrEngine.recognize(samples)
            }.get(ASR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            JSONObject().put("text", text).toString()
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
                    recognizeAsyncPayload(samples, useVoiceprint, multiSpeaker)
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
    private fun recognizeAsyncPayload(samples: FloatArray, useVoiceprint: Boolean, multiSpeaker: Boolean): JSONObject {
        if (!useVoiceprint || !voiceprintEnabled || !voiceprintModelManager.isReady || !VoiceprintEngine.ready) {
            return JSONObject().put("text", AsrEngine.recognize(samples))
        }
        if (multiSpeaker) {
            if (samples.isEmpty()) return JSONObject().put("error", "音频数据为空")
            val segments = VoiceprintEngine.diarize(samples)
            val indexMergedSegments = VoiceprintSegmentMerger.merge(segments.map { seg ->
                VoiceprintSegmentMerger.DiarizedSegment(seg.start, seg.end, seg.speakerIndex)
            })
            val matchedSegments = indexMergedSegments.map { seg ->
                val startIdx = (seg.start * 16000).toInt().coerceIn(0, samples.size - 1)
                val endIdx = (seg.end * 16000).toInt().coerceIn(startIdx + 1, samples.size)
                val embedding = VoiceprintEngine.extract(samples.copyOfRange(startIdx, endIdx))
                VoiceprintSegmentMerger.MatchedSegment(seg.start, seg.end, VoiceprintEngine.match(embedding))
            }
            val mergedSegments = VoiceprintSegmentMerger.mergeMatched(matchedSegments)
            val arr = org.json.JSONArray()
            for (seg in mergedSegments) {
                val startIdx = (seg.start * 16000).toInt().coerceIn(0, samples.size - 1)
                val endIdx = (seg.end * 16000).toInt().coerceIn(startIdx + 1, samples.size)
                val mergedSamples = samples.copyOfRange(startIdx, endIdx)
                val text = if (mergedSamples.size >= 1600) AsrEngine.recognize(mergedSamples) else ""
                arr.put(JSONObject()
                    .put("start", seg.start.toDouble())
                    .put("end", seg.end.toDouble())
                    .put("text", text)
                    .put("speaker", seg.speaker ?: JSONObject.NULL))
            }
            return JSONObject().put("segments", arr)
        }
        val text = AsrEngine.recognize(samples)
        val embedding = VoiceprintEngine.extract(samples)
        val speaker = VoiceprintEngine.match(embedding)
        return JSONObject()
            .put("text", text)
            .put("speaker", speaker ?: JSONObject.NULL)
            .put("dim", VoiceprintEngine.dim)
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

    private fun readCoreCount(config: JSONObject?, fieldName: String): Int {
        val raw = config?.opt(fieldName)
        return when (raw) {
            is Number -> raw.toInt().coerceAtLeast(0)
            else -> 1
        }
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
                .toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "声纹状态异常").toString()
        }
    }

    // 配置声纹引擎：{"enabled":bool,"threshold":0.5,"multiSpeaker":bool}；触发模型下载+引擎加载
    // 结果经 window.onVoiceprintModel 回调（downloading/ready/error）
    @JavascriptInterface
    fun voiceprintConfigure(configJson: String): String {
        return try {
            val cfg = org.json.JSONObject(configJson)
            voiceprintEnabled = cfg.optBoolean("enabled", true)
            voiceprintThreshold = cfg.optDouble("threshold", 0.5).toFloat()
            voiceprintMultiSpeaker = cfg.optBoolean("multiSpeaker", true)
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
                        voiceprintThreshold, voiceprintMultiSpeaker)
                    event.put("engineReady", loaded)
                }
                val js = "window.onVoiceprintModel && window.onVoiceprintModel(${event.toString()});"
                webView.evaluateJavascript(js, null)
            }
            if (ensureResult == "ready") {
                // 应用配置（threshold/multiSpeaker），此时 embedding 与 segmentation 均已就绪
                val loaded = VoiceprintEngine.load(
                    webView.context, voiceprintModelManager.embeddingModelPath,
                    if (voiceprintMultiSpeaker) voiceprintModelManager.segmentationModelPath else null,
                    voiceprintThreshold, voiceprintMultiSpeaker)
                val js = "window.onVoiceprintModel && window.onVoiceprintModel(${JSONObject().put("state","ready").put("engineReady",loaded)});"
                webView.evaluateJavascript(js, null)
            }
            JSONObject().put("ok", true).toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "声纹配置异常").toString()
        }
    }

    // 单段声纹匹配：裸 PCM base64 → {"speaker":人名|null} 或 {"error":"..."}
    @JavascriptInterface
    fun voiceprintMatch(pcmBase64: String): String {
        return try {
            if (!voiceprintEnabled || !voiceprintModelManager.isReady || !VoiceprintEngine.ready) {
                return JSONObject().put("error", "模型未就绪").toString()
            }
            val bytes = Base64.decode(pcmBase64, Base64.DEFAULT)
            val samples = AsrPcm.decodeS16(bytes)
            val embedding = asrExecutor.submit<FloatArray> { VoiceprintEngine.extract(samples) }.get(ASR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            val speaker = VoiceprintEngine.match(embedding)
            JSONObject().put("speaker", speaker ?: JSONObject.NULL).put("dim", VoiceprintEngine.dim).toString()
        } catch (e: java.util.concurrent.TimeoutException) {
            JSONObject().put("error", "声纹识别超时").toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "声纹识别失败").toString()
        }
    }

    // 多人分割+声纹匹配+合并原始音频后识别：裸 PCM base64 → {"segments":[{start,end,text,speaker}]} 或 {"error":"..."}
    // 先按 speakerIndex 合并再匹配声纹名，最后按相邻同名 speaker 再合并原始 PCM，避免短片段边界截断 ASR 文本。
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
            val segJson = asrExecutor.submit<org.json.JSONArray> {
                val segments = VoiceprintEngine.diarize(samples)
                val indexMergedSegments = VoiceprintSegmentMerger.merge(segments.map { seg ->
                    VoiceprintSegmentMerger.DiarizedSegment(seg.start, seg.end, seg.speakerIndex)
                })
                val matchedSegments = indexMergedSegments.map { seg ->
                    val startIdx = (seg.start * 16000).toInt().coerceIn(0, samples.size - 1)
                    val endIdx = (seg.end * 16000).toInt().coerceIn(startIdx + 1, samples.size)
                    val segmentSamples = samples.copyOfRange(startIdx, endIdx)
                    val embedding = VoiceprintEngine.extract(segmentSamples)
                    val speaker = VoiceprintEngine.match(embedding)
                    VoiceprintSegmentMerger.MatchedSegment(seg.start, seg.end, speaker)
                }
                val mergedSegments = VoiceprintSegmentMerger.mergeMatched(matchedSegments)
                val arr = org.json.JSONArray()
                for (seg in mergedSegments) {
                    val startIdx = (seg.start * 16000).toInt().coerceIn(0, samples.size - 1)
                    val endIdx = (seg.end * 16000).toInt().coerceIn(startIdx + 1, samples.size)
                    val mergedSamples = samples.copyOfRange(startIdx, endIdx)
                    val text = if (mergedSamples.size >= 1600) AsrEngine.recognize(mergedSamples) else ""
                    arr.put(org.json.JSONObject()
                        .put("start", seg.start.toDouble())
                        .put("end", seg.end.toDouble())
                        .put("text", text)
                        .put("speaker", seg.speaker))
                }
                arr
            }.get(ASR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            JSONObject().put("segments", segJson).toString()
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
