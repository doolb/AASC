package com.aasc.display

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// display.html 的原生桥：截图（真实像素）+ 输入注入（真实触摸/按键，跨域内容可用）
class NativeBridge(
    private val webView: WebView,
    private val mainHandler: Handler = Handler(Looper.getMainLooper())
) {

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
}
