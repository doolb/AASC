package com.aasc.display

import android.app.Activity
import android.os.Build
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import kotlin.math.abs

/** 按APK打包资源统一系统栏策略；刷新率只提交窗口偏好，不切换物理分辨率。 */
object AndroidDisplayWindowPolicy {
    @Suppress("DEPRECATION")
    fun apply(activity: Activity, offline: Boolean) {
        val window = activity.window
        when {
            offline -> {
                window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
                window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                if (Build.VERSION.SDK_INT >= 30) {
                    window.setDecorFitsSystemWindows(true)
                    window.insetsController?.show(WindowInsets.Type.systemBars())
                }
            }
            Build.VERSION.SDK_INT >= 30 -> window.insetsController?.hide(WindowInsets.Type.systemBars())
            else -> {
                window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
            }
        }
        try {
            preferSixtyHertz(activity)
        } catch (error: Exception) {
            // 厂商窗口实现可能拒绝刷新偏好，保留网页60FPS调度，不能因此中断显示端。
            android.util.Log.w("AASC-Window", "提交60Hz窗口偏好失败", error)
        }
    }

    @Suppress("DEPRECATION")
    private fun preferSixtyHertz(activity: Activity) {
        val window = activity.window
        val attributes = window.attributes
        var changed = attributes.preferredRefreshRate != 60f
        attributes.preferredRefreshRate = 60f
        if (Build.VERSION.SDK_INT >= 23) {
            val display = if (Build.VERSION.SDK_INT >= 30) activity.display ?: activity.windowManager.defaultDisplay
                else activity.windowManager.defaultDisplay
            val current = display.mode
            val preferred = display.supportedModes.filter { mode ->
                mode.physicalWidth == current.physicalWidth && mode.physicalHeight == current.physicalHeight
                    && abs(mode.refreshRate - 60f) <= .5f
            }.minByOrNull { mode -> abs(mode.refreshRate - 60f) }
            val modeId = preferred?.modeId ?: 0
            changed = changed || attributes.preferredDisplayModeId != modeId
            attributes.preferredDisplayModeId = modeId
        }
        if (changed) window.attributes = attributes
    }
}
