package com.aasc.display

import android.app.Activity
import android.app.AlertDialog
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** 手动分组入口与min首次确认共用准备流程；后台状态查询不下载模型。 */
internal object OfflineModelPreparationDialog {
    private val worker = Executors.newSingleThreadExecutor()

    fun show(activity: Activity, store: OfflineModelStore, onPrepared: (String) -> Unit) {
        if (activity.isFinishing || activity.isDestroyed) return
        val groups = store.groups()
        AlertDialog.Builder(activity).setTitle("本机模型")
            .setItems(groups.map { group ->
                val plan = OfflineModelPreparationPlan(store.definitions, listOf(group))
                "${group.title} · ${mib(plan.totalBytes)} MiB · ${if (plan.pendingBytes(store::hasLocalFiles) == 0L) "本地已有" else "待准备"}"
            }.toTypedArray()) { _, index -> confirm(activity, store, listOf(groups[index]), onPrepared) }
            .setNegativeButton("关闭", null).show()
    }

    /** 首次提示本身就是下载确认，默认选择两组，稍后/取消都不会开始准备。 */
    fun showFirstRun(activity: Activity, store: OfflineModelStore, onPrepared: (String) -> Unit): Boolean {
        if (activity.isFinishing || activity.isDestroyed) return false
        val groups = store.groups().filter { it.defaultSelected }
        val selected = BooleanArray(groups.size) { true }
        fun message(): String {
            val plan = OfflineModelPreparationPlan(store.definitions, groups.filterIndexed { index, _ -> selected[index] })
            return "本机环境已就绪，建议准备语音模型。所选模型需下载约 ${mib(plan.pendingBytes(store::hasLocalFiles))} MiB，已有文件会复用。\n来源：局域网镜像或公网；准备后可离线使用。"
        }
        fun buttonLabel(): String {
            val plan = OfflineModelPreparationPlan(store.definitions, groups.filterIndexed { index, _ -> selected[index] })
            return if (plan.pendingBytes(store::hasLocalFiles) == 0L) "准备所选" else "下载所选"
        }
        // Android原生AlertDialog的message与列表不能稳定同时展示，统一放入原生自定义内容区。
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            val padding = (24 * resources.displayMetrics.density).toInt()
            setPadding(padding, 0, padding, 0)
        }
        val hint = TextView(activity).apply { text = message(); textSize = 16f }
        content.addView(hint)
        var dialog: AlertDialog? = null
        groups.forEachIndexed { index, group ->
            val plan = OfflineModelPreparationPlan(store.definitions, listOf(group))
            content.addView(CheckBox(activity).apply {
                val pending = plan.pendingBytes(store::hasLocalFiles)
                text = "${group.title} · ${if (pending == 0L) "本地已有" else "约 ${mib(pending)} MiB待下载"}"
                isChecked = true
                setOnCheckedChangeListener { _, checked ->
                    selected[index] = checked
                    hint.text = message()
                    dialog?.getButton(AlertDialog.BUTTON_POSITIVE)?.isEnabled = selected.any { it }
                    dialog?.getButton(AlertDialog.BUTTON_POSITIVE)?.text = buttonLabel()
                }
            })
        }
        dialog = AlertDialog.Builder(activity).setTitle("准备语音模型")
            .setView(content)
            .setPositiveButton(buttonLabel()) { _, _ ->
                val chosen = groups.filterIndexed { index, _ -> selected[index] }
                if (chosen.isNotEmpty()) prepare(activity, store, chosen, onPrepared)
            }
            .setNegativeButton("稍后", null).show()
        return true
    }

    private fun confirm(activity: Activity, store: OfflineModelStore, groups: List<OfflineModelGroup>,
        onPrepared: (String) -> Unit, forceDownload: Boolean = false) {
        if (activity.isFinishing || activity.isDestroyed) return
        val plan = OfflineModelPreparationPlan(store.definitions, groups)
        val local = !forceDownload && plan.pendingBytes(store::hasLocalFiles) == 0L
        AlertDialog.Builder(activity).setTitle(groups.joinToString("、") { it.title })
            .setMessage(if (local) "将校验并加载本机文件，无需下载。" else
                "${if (forceDownload) "必要时最多下载" else "需下载约"} ${mib(if (forceDownload) plan.totalBytes else plan.pendingBytes(store::hasLocalFiles))} MiB，将从局域网镜像或外网 aimodel 下载。准备后可离线使用；先前的语音或聊天请求请重新发起。")
            .setPositiveButton(if (local) "加载" else "下载") { _, _ ->
                prepare(activity, store, groups, onPrepared, forceDownload)
            }.setNegativeButton("稍后", null).show()
    }

    private fun prepare(activity: Activity, store: OfflineModelStore, groups: List<OfflineModelGroup>,
        onPrepared: (String) -> Unit, forceDownload: Boolean = false) {
        val plan = OfflineModelPreparationPlan(store.definitions, groups)
        val cancelled = AtomicBoolean(false)
        fun cancel() {
            cancelled.set(true)
            plan.models.forEach { store.cancel(it.modelId) }
        }
        val progress = AlertDialog.Builder(activity).setTitle("准备本机模型")
            .setMessage("正在准备 ${groups.joinToString("、") { it.title }}")
            .setNegativeButton("取消") { _, _ -> cancel() }
            .setOnCancelListener { cancel() }.show()
        worker.execute {
            try {
                store.prepareGroups(groups, forceDownload, cancelled::get, { modelId, value ->
                    activity.runOnUiThread {
                        if (!cancelled.get() && !activity.isDestroyed && progress.isShowing)
                            progress.setMessage("$modelId\n整体下载/校验 $value%")
                    }
                }, { modelId ->
                    // UI排队期间仍可能取消或销毁，迟到的完成通知不能重新加载旧选择。
                    activity.runOnUiThread { if (!cancelled.get() && !activity.isDestroyed) onPrepared(modelId) }
                })
                activity.runOnUiThread { if (!activity.isDestroyed) progress.dismiss() }
            } catch (error: Exception) {
                activity.runOnUiThread {
                    if (activity.isDestroyed) return@runOnUiThread
                    progress.dismiss()
                    if (!cancelled.get()) AlertDialog.Builder(activity)
                        .setTitle("模型准备失败").setMessage(error.message)
                        .setPositiveButton("重新准备") { _, _ -> confirm(activity, store, groups, onPrepared, true) }
                        .setNegativeButton("稍后", null).show()
                }
            }
        }
    }

    private fun mib(bytes: Long): Long = (bytes + 1024 * 1024 - 1) / (1024 * 1024)
}
