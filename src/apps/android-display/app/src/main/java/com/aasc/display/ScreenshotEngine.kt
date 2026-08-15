package com.aasc.display

import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Base64
import android.webkit.WebView
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

object ScreenshotEngine {

    // 与显示端 ControlModeUtils.fitSizeTo720p 一致：长边 ≤ 1280 等比缩放
    fun fitSize(w: Int, h: Int, maxLongEdge: Int = 1280): Pair<Int, Int> {
        val scale = minOf(1.0, maxLongEdge.toDouble() / maxOf(w, h))
        return Pair((w * scale).roundToInt(), (h * scale).roundToInt())
    }

    // 必须在主线程调用（WebView.draw 线程约束）；WebView 渲染位图 = 真实像素，跨域内容同样可读
    fun capture(webView: WebView, callback: (String?, Int, Int) -> Unit) {
        try {
            val w = webView.width
            val h = webView.height
            if (w <= 0 || h <= 0) {
                callback(null, 0, 0)
                return
            }
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            webView.draw(Canvas(bitmap))
            val fit = fitSize(w, h)
            val scaled = if (fit.first == w && fit.second == h) bitmap
                else Bitmap.createScaledBitmap(bitmap, fit.first, fit.second, true)
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 70, out)
            val dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            callback(dataUrl, fit.first, fit.second)
        } catch (e: Exception) {
            callback(null, 0, 0)
        }
    }
}
