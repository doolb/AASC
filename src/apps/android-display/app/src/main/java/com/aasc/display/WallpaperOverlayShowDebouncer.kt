package com.aasc.display

/** 显示前等待桌面状态稳定；隐藏始终立即执行，过期任务不能重新显示。 */
internal class WallpaperOverlayShowDebouncer(
    private val schedule: (Runnable, Long) -> Unit,
    private val cancel: (Runnable) -> Unit,
    private val show: () -> Unit,
    private val hide: () -> Unit
) {
    private var generation = 0L
    private var pending: Runnable? = null

    fun requestShow() {
        pending?.let(cancel)
        val token = ++generation
        val task = Runnable {
            if (token == generation) {
                pending = null
                show()
            }
        }
        pending = task
        schedule(task, 250L)
    }

    fun hideNow() {
        generation++
        pending?.let(cancel)
        pending = null
        hide()
    }
}
