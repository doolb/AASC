package com.aasc.display

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.view.accessibility.AccessibilityEvent

/** 仅使用已有无障碍窗口事件判断桌面；未知状态保留壁纸可见性回退。 */
object WallpaperDesktopTracker {
    var isDesktop: Boolean? = null
        private set
    private val listeners = mutableSetOf<(Boolean?) -> Unit>()

    fun addListener(listener: (Boolean?) -> Unit) { listeners.add(listener) }
    fun removeListener(listener: (Boolean?) -> Unit) { listeners.remove(listener) }

    fun reset() = update(null)

    fun onWindowEvent(context: Context, event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val packageName = event.packageName?.toString().orEmpty()
        // 系统浮窗和应用自身的私有 Presentation 不应取代实际前台应用。
        if (packageName.isBlank() || packageName == "com.android.systemui") return
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val homes = try {
            context.packageManager.queryIntentActivities(home, PackageManager.MATCH_DEFAULT_ONLY)
                .mapNotNull { it.activityInfo?.packageName }.toSet()
        } catch (_: Exception) {
            update(null)
            return
        }
        if (homes.isEmpty() && packageName != context.packageName) { update(null); return }
        val result = WallpaperDesktopPolicy.classify(packageName, event.className?.toString().orEmpty(), context.packageName, homes)
        if (result != null) update(result)
    }

    private fun update(value: Boolean?) {
        if (isDesktop == value) return
        isDesktop = value
        listeners.toList().forEach { it(value) }
    }
}
