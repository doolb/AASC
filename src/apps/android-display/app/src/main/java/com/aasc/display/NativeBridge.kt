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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// display.html 的原生桥：截图（真实像素）+ 输入注入（真实触摸/按键，跨域内容可用）
class NativeBridge(
    private val webView: WebView,
    private val mainHandler: Handler = Handler(Looper.getMainLooper())
) {

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
    // 识别串行化：单线程执行器避免并发识别（与服务器单请求语义一致），future.get 带超时
    private val asrExecutor = Executors.newSingleThreadExecutor()

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
            val text = asrExecutor.submit {
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
}
