package com.aasc.display

/** 保护渐隐结束回调，快速重新显示时不得移除当前窗口。 */
internal class WallpaperOverlayTransition {
    private var generation = 0L
    var hiding = false
        private set

    fun beginHide(): Long? {
        if (hiding) return null
        hiding = true
        return ++generation
    }

    fun show() { hiding = false; generation++ }
    fun mayRemove(token: Long): Boolean = hiding && token == generation
}
