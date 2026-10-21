package com.aasc.display

/** 仅由主线程调用；关闭指定旧实例，避免迟到清理销毁后来重建的页面。Cookie由调用方独立持有。 */
internal class DoubaoWebViewPageCache<T : Any>(private val destroy: (T) -> Unit) {
    var current: T? = null
        private set

    fun getOrCreate(create: () -> T): T {
        current?.let { return it }
        return create().also { current = it }
    }

    fun clear(expected: T? = current): Boolean {
        val page = current ?: return false
        if (page !== expected) return false
        current = null
        destroy(page)
        return true
    }
}
