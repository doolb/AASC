package com.aasc.display

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

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

    // 异步截图：JS 传函数源码字符串，完成后回调 (<callback>)("dataUrl", w, h)
    @JavascriptInterface
    fun takeScreenshot(callback: String) {
        mainHandler.post {
            ScreenshotEngine.capture(webView) { dataUrl, w, h ->
                runJs("($callback)(${quote(dataUrl)}, $w, $h)")
            }
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

    private fun runJs(js: String) {
        webView.post { webView.evaluateJavascript(js, null) }
    }

    private fun quote(s: String?): String {
        if (s == null) return "null"
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"
    }
}
