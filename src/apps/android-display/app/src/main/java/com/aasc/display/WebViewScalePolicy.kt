package com.aasc.display

import kotlin.math.roundToInt

enum class WebViewDeviceClass {
    PHONE,
    COMPUTER
}

/**
 * 根据 APK 模式统一提供 WebView 初始页面比例。
 *
 * Offline APK 的显示页和控制页按当前显示屏类别、分辨率长边与 densityDpi 计算页面比例，
 * 以 1280 像素、320 dpi 为因子 1.0 基准，使用设备类别校准系数并限制在因子 1.0～3.0；
 * 普通 APK 保持中性的因子 1.0。
 * 页面比例只作用于应用 WebView，不读取或修改系统显示配置。
 */
object WebViewScalePolicy {

    private const val BASELINE_LONG_EDGE_PIXELS = 1280
    private const val BASELINE_DENSITY_DPI = 320
    private const val STANDARD_SCALE_PERCENT = 100
    private const val PHONE_SCALE_COEFFICIENT = 1.108705067128627
    private const val COMPUTER_SCALE_COEFFICIENT = 1.0
    private const val MIN_SCALE_FACTOR = 1.0
    private const val MAX_SCALE_FACTOR = 3.0
    private const val PHONE_MAX_SMALLEST_WIDTH_DP = 600

    /** 根据当前显示区域的最小宽度判断手机还是电脑/外部大屏。 */
    fun deviceClass(smallestScreenWidthDp: Int): WebViewDeviceClass {
        return if (
            smallestScreenWidthDp > 0
                && smallestScreenWidthDp < PHONE_MAX_SMALLEST_WIDTH_DP
        ) {
            WebViewDeviceClass.PHONE
        } else {
            WebViewDeviceClass.COMPUTER
        }
    }

    private fun deviceCoefficient(deviceClass: WebViewDeviceClass): Double {
        return when (deviceClass) {
            WebViewDeviceClass.PHONE -> PHONE_SCALE_COEFFICIENT
            WebViewDeviceClass.COMPUTER -> COMPUTER_SCALE_COEFFICIENT
        }
    }

    /**
     * 计算不带百分号的页面缩放因子。
     *
     * 设备类别只提供校准系数，具体分辨率和 densityDpi 始终来自运行时当前 Display，
     * 因此不会针对某一个机型或某一组固定分辨率写分支。
     */
    fun scaleFactor(
        offlineMode: Boolean,
        widthPixels: Int,
        heightPixels: Int,
        densityDpi: Int,
        deviceClass: WebViewDeviceClass
    ): Double {
        if (!offlineMode) return MIN_SCALE_FACTOR
        if (widthPixels <= 0 || heightPixels <= 0 || densityDpi <= 0) {
            return MIN_SCALE_FACTOR
        }

        val longEdgePixels = maxOf(widthPixels, heightPixels)
        val resolutionRatio = longEdgePixels.toDouble() / BASELINE_LONG_EDGE_PIXELS
        val densityRatio = densityDpi.toDouble() / BASELINE_DENSITY_DPI
        val rawScaleFactor = resolutionRatio * densityRatio * deviceCoefficient(deviceClass)
        return rawScaleFactor.coerceIn(MIN_SCALE_FACTOR, MAX_SCALE_FACTOR)
    }

    /**
     * 根据 APK 模式、当前显示分辨率、densityDpi 和设备类别计算 WebView 初始页面比例。
     *
     * 分辨率取长边，保证横竖屏使用同一套规则；320 dpi 是 1280 像素基准的密度参照。
     * 设备类别只改变校准系数；因子限制在 1.0～3.0，再转换成百分比。
     * Android 在无法提供有效显示参数时回退到 100%，避免启动阶段传入无效缩放值。
     */
    fun initialScalePercent(
        offlineMode: Boolean,
        widthPixels: Int,
        heightPixels: Int,
        densityDpi: Int,
        deviceClass: WebViewDeviceClass = WebViewDeviceClass.COMPUTER
    ): Int {
        val factor = scaleFactor(
            offlineMode = offlineMode,
            widthPixels = widthPixels,
            heightPixels = heightPixels,
            densityDpi = densityDpi,
            deviceClass = deviceClass
        )
        return (factor * STANDARD_SCALE_PERCENT).roundToInt()
    }
}
