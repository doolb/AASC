package com.aasc.display

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import android.app.ActivityManager
import android.os.Build
import java.io.RandomAccessFile
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// display.html 的原生桥：截图（真实像素）+ 输入注入（真实触摸/按键，跨域内容可用）
class NativeBridge(
    private val webView: WebView,
    private val mainHandler: Handler = Handler(Looper.getMainLooper())
) {

    private var lastCpuIdle: Long = -1
    private var lastCpuTotal: Long = -1

    // 读取 /proc/stat cpu 行两次采样差值，计算 CPU 使用率（%），1 位小数
    private fun readCpuPercent(): Double {
        var idle = 0L
        var total = 0L
        try {
            RandomAccessFile("/proc/stat", "r").use { raf ->
                val line = raf.readLine() ?: return 0.0
                // "cpu  user nice system idle iowait irq softirq steal ..."
                val parts = line.trim().split(Regex("\\s+"))
                if (parts.size < 5 || parts[0] != "cpu") return 0.0
                var sum = 0L
                for (i in 1 until parts.size) {
                    val v = parts[i].toLongOrNull() ?: 0L
                    sum += v
                }
                idle = parts[4].toLongOrNull() ?: 0L
                total = sum
            }
        } catch (_: Exception) {
            return 0.0
        }
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
}
