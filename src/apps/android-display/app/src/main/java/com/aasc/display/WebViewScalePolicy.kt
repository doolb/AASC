package com.aasc.display

import kotlin.math.roundToInt

/**
 * 根据 APK 模式统一提供 WebView 初始页面比例。
 *
 * Offline APK 的显示页和控制页按当前显示分辨率的长边与 densityDpi 计算页面比例，
 * 以 1280 像素、320 dpi 为 100% 基准，并对两种比例做等权混合；普通 APK 保持中性的 100%。
 * 页面比例只作用于应用 WebView，不读取或修改系统显示配置。
 */
object WebViewScalePolicy {

    private const val BASELINE_LONG_EDGE_PIXELS = 1280
    private const val BASELINE_DENSITY_DPI = 320
    private const val STANDARD_SCALE_PERCENT = 100

    /**
     * 根据 APK 模式、当前显示分辨率和 densityDpi 计算 WebView 初始页面比例。
     *
     * 分辨率取长边，保证横竖屏使用同一套规则；320 dpi 是 1280 像素基准的密度参照。
     * 分辨率比例和密度比例等权平均，避免任一维度单独把页面比例推到过小或过大。
     * 计算结果按百分比四舍五入；Android 在无法提供有效显示参数时回退到 100%，
     * 避免启动阶段传入无效缩放值。
     */
    fun initialScalePercent(
        offlineMode: Boolean,
        widthPixels: Int,
        heightPixels: Int,
        densityDpi: Int
    ): Int {
        if (!offlineMode) return STANDARD_SCALE_PERCENT
        if (widthPixels <= 0 || heightPixels <= 0 || densityDpi <= 0) {
            return STANDARD_SCALE_PERCENT
        }

        val longEdgePixels = maxOf(widthPixels, heightPixels)
        val resolutionRatio = longEdgePixels.toDouble() / BASELINE_LONG_EDGE_PIXELS
        val densityRatio = densityDpi.toDouble() / BASELINE_DENSITY_DPI
        val blendedRatio = (resolutionRatio + densityRatio) / 2.0
        val scalePercent = blendedRatio * STANDARD_SCALE_PERCENT
        return scalePercent
            .roundToInt()
            .coerceAtLeast(1)
    }
}
