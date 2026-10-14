package com.aasc.display

import android.app.Activity
import android.app.AlertDialog
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** 仅由用户点击“本机模型”打开；后台状态查询不会弹下载确认。 */
internal object OfflineModelPreparationDialog {
    private val worker = Executors.newSingleThreadExecutor()

    fun show(activity: Activity, store: OfflineModelStore, onPrepared: (String) -> Unit) {
        if (activity.isFinishing || activity.isDestroyed) return
        val models = store.definitions
        AlertDialog.Builder(activity).setTitle("本机模型")
            .setItems(models.map { model ->
                "${model.modelId} · ${model.totalBytes / (1024 * 1024)} MiB · ${if (store.hasLocalFiles(model.modelId)) "本地已有" else "待准备"}"
            }.toTypedArray()) { _, index -> confirm(activity, store, models[index], onPrepared) }
            .setNegativeButton("关闭", null).show()
    }

    private fun confirm(activity: Activity, store: OfflineModelStore, model: OfflineModelDefinition,
        onPrepared: (String) -> Unit, forceDownload: Boolean = false) {
        val local = !forceDownload && store.hasLocalFiles(model.modelId)
        AlertDialog.Builder(activity).setTitle(model.modelId)
            .setMessage(if (local) "将校验并加载本机文件，无需下载。" else
                "模型约 ${model.totalBytes / (1024 * 1024)} MiB，将从局域网镜像或外网 aimodel 下载。准备完成后可离线使用；先前的语音或聊天请求请重新发起。")
            .setPositiveButton(if (local) "加载" else "下载") { _, _ ->
                val cancelled = AtomicBoolean(false)
                val progress = AlertDialog.Builder(activity).setTitle("准备本机模型")
                    .setMessage("正在准备 ${model.modelId}")
                    .setNegativeButton("取消") { _, _ -> cancelled.set(true); store.cancel(model.modelId) }
                    .setOnCancelListener { cancelled.set(true); store.cancel(model.modelId) }.show()
                worker.execute {
                    try {
                        if (cancelled.get()) return@execute
                        store.prepare(model.modelId, allowDownload = !local) { value ->
                            if (cancelled.get()) throw java.util.concurrent.CancellationException("已取消模型准备")
                            activity.runOnUiThread { if (progress.isShowing) progress.setMessage("${model.modelId}\n下载/校验 $value%") }
                        }
                        if (!cancelled.get()) activity.runOnUiThread { progress.dismiss(); onPrepared(model.modelId) }
                    } catch (error: Exception) {
                        activity.runOnUiThread {
                            progress.dismiss()
                            if (!cancelled.get() && !activity.isDestroyed) AlertDialog.Builder(activity)
                                .setTitle("模型准备失败").setMessage(error.message)
                                .setPositiveButton(if (local) "重新准备" else "知道了") { _, _ ->
                                    if (local) confirm(activity, store, model, onPrepared, true)
                                }.show()
                        }
                    }
                }
            }.setNegativeButton("稍后", null).show()
    }
}
