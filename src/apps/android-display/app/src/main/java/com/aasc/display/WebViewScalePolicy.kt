package com.aasc.display

import kotlin.math.roundToInt

/**
 * 根据 APK 模式统一提供 WebView 初始页面比例。
 *
 * Offline APK 的显示页和控制页按当前显示分辨率的长边计算页面比例，
 * 以长边 1280 像素为 100% 基准；普通 APK 保持中性的 100%。
 * 页面比例只作用于应用 WebView，不读取或修改设备 densityDpi。
 */
object WebViewScalePolicy {

    private const val BASELINE_LONG_EDGE_PIXELS = 1280
    private const val STANDARD_SCALE_PERCENT = 100

    /**
     * 根据 APK 模式和当前显示分辨率计算 WebView 初始页面比例。
     *
     * 分辨率取长边，保证横竖屏使用同一套规则；计算结果按百分比四舍五入。
     * Android 在无法提供有效分辨率时回退到 100%，避免启动阶段传入无效缩放值。
     */
    fun initialScalePercent(offlineMode: Boolean, widthPixels: Int, heightPixels: Int): Int {
        if (!offlineMode) return STANDARD_SCALE_PERCENT
        if (widthPixels <= 0 || heightPixels <= 0) return STANDARD_SCALE_PERCENT

        val longEdgePixels = maxOf(widthPixels, heightPixels)
        return (longEdgePixels.toDouble() * STANDARD_SCALE_PERCENT / BASELINE_LONG_EDGE_PIXELS)
            .roundToInt()
            .coerceAtLeast(1)
    }
}
