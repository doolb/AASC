package com.aasc.display

import kotlin.math.roundToInt

/**
 * 统一计算 APK 网页的初始页面缩放比例。
 *
 * 显示端页面中的 render-display 仪表盘、媒体叠加层和控制端页面大量使用固定
 * CSS 像素。Android WebView 在高 density 屏幕上会让同一个 CSS 像素占用更多
 * 物理像素，因此这里以 mdpi（160 dpi）作为固定像素 UI 的基准，只缩小高密度
 * 页面，不放大低密度页面。
 */
object WebViewScalePolicy {

    private const val BASELINE_DENSITY_DPI = 160
    private const val DEFAULT_SCALE_PERCENT = 100
    private const val MIN_SCALE_PERCENT = 25

    /**
     * 根据显示屏 densityDpi 计算 WebView.setInitialScale 所需的百分比。
     *
     * 无效 density 不能阻断页面启动；极高密度屏幕也保留最小比例，避免出现
     * WebView 页面完全不可读或某些旧版 Chromium 拒绝过小缩放的情况。
     */
    fun initialScalePercent(densityDpi: Int): Int {
        if (densityDpi <= 0) return DEFAULT_SCALE_PERCENT

        val scalePercent = (BASELINE_DENSITY_DPI * DEFAULT_SCALE_PERCENT.toFloat() / densityDpi)
            .roundToInt()
        return scalePercent.coerceIn(MIN_SCALE_PERCENT, DEFAULT_SCALE_PERCENT)
    }
}
