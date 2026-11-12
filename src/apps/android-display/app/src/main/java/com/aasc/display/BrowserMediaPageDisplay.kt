package com.aasc.display

import android.webkit.WebView

/** 仅在主线程切换当前展示页；切换不销毁其他后台会话。 */
internal object BrowserMediaPageDisplay {
    var current: WebView? = null
        private set
    private var owner: Any? = null
    private var render: ((WebView?) -> Unit)? = null
    private fun notifyViewer(page: WebView?) {
        runCatching { render?.invoke(page) }
    }
    fun observe(viewer: Any, callback: (WebView?) -> Unit) {
        notifyViewer(null); owner = viewer; render = callback; notifyViewer(current)
    }
    fun stopObserving(viewer: Any) {
        if (owner !== viewer) return
        notifyViewer(null); owner = null; render = null
    }
    fun show(page: WebView?) {
        if (current === page) return
        notifyViewer(null); current = page; notifyViewer(page)
    }
}
