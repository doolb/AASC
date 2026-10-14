package com.aasc.display

import android.content.Context
import android.webkit.JavascriptInterface

/** 控制页的只读模型状态桥，隔离配置/登录桥职责，查询不触发下载或原生加载。 */
internal class OfflineModelStatusBridge(context: Context, offlineMode: Boolean) {
    private val store = if (offlineMode) OfflineModelStore(context) else null
    private val repairRoot = if (offlineMode) java.io.File(context.filesDir, "aasc-server") else null

    @JavascriptInterface
    fun status(): String = store?.statusJson() ?: "[]"

    /** 仅读取有界版本/结果；自测不能执行修复或触发下载。 */
    @JavascriptInterface
    fun dataRepairStatus(): String = repairRoot?.let { root ->
        runCatching {
            val state = OfflineDataRepairState.state(root)
            val pending = OfflineDataRepairState.pending(root)
            org.json.JSONObject().put("dataVersion", state.optInt("dataVersion", 0))
                .put("latestRepairVersion", state.optInt("latestRepairVersion", 0))
                .put("pending", pending != null)
                .put("satisfied", pending == null || OfflineDataRepairState.completion(root, pending).first).toString()
        }.getOrElse { org.json.JSONObject().put("error", "数据修复状态无效").toString() }
    } ?: "{}"
}
