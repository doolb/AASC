package com.aasc.display

/** 仅由主线程调用；关闭指定旧实例，避免迟到清理销毁后来重建的页面。Cookie由调用方独立持有。 */
internal class DoubaoWebViewPageCache<T : Any>(private val destroy: (T) -> Unit) {
    @Volatile var current: T? = null
        private set
    private var viewer: Any? = null
    private var render: ((T?) -> Unit)? = null

    /** 查看者只借用同一页面；旧窗口退出不能卸载后来接管的新窗口。调用均在主线程。 */
    fun observe(owner: Any, show: (T?) -> Unit) {
        notifyViewer(null)
        viewer = owner
        render = show
        notifyViewer(current)
    }

    fun stopObserving(owner: Any) {
        if (viewer !== owner) return
        notifyViewer(null)
        viewer = null
        render = null
    }

    private fun notifyViewer(page: T?) {
        try { render?.invoke(page) }
        catch (_: Exception) { /* 查看窗口的迟到回调不能中断后台签名、请求或页面回收。 */ }
    }

    fun getOrCreate(create: () -> T): T {
        current?.let { return it }
        return create().also { current = it; notifyViewer(it) }
    }

    fun clear(expected: T? = current): Boolean {
        val page = current ?: return false
        if (page !== expected) return false
        current = null
        // 必须先让Activity移除旧视图，再销毁WebView，避免父容器保留已销毁页面。
        notifyViewer(null)
        destroy(page)
        return true
    }
}
