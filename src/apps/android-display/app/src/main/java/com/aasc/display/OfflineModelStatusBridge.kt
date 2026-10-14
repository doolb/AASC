package com.aasc.display

import android.content.Context
import android.webkit.JavascriptInterface

/** 控制页的只读模型状态桥，隔离配置/登录桥职责，查询不触发下载或原生加载。 */
internal class OfflineModelStatusBridge(context: Context, offlineMode: Boolean) {
    private val store = if (offlineMode) OfflineModelStore(context) else null

    @JavascriptInterface
    fun status(): String = store?.statusJson() ?: "[]"
}
