package com.aasc.display

import java.util.concurrent.CancellationException

/** 下载入口只聚合模型ID，各模型仍使用自己的可信定义、缓存和原子提交。 */
internal data class OfflineModelGroup(
    val id: String,
    val title: String,
    val modelIds: List<String>,
    val defaultSelected: Boolean = false
)

internal class OfflineModelPreparationPlan(
    definitions: List<OfflineModelDefinition>,
    groups: List<OfflineModelGroup>
) {
    val models = groups.flatMap { it.modelIds }.distinct().map { id ->
        definitions.firstOrNull { it.modelId == id } ?: error("未声明的本机模型: $id")
    }
    val totalBytes = models.fold(0L) { total, model -> Math.addExact(total, model.totalBytes) }

    fun pendingBytes(hasLocalFiles: (String) -> Boolean): Long = models
        .filterNot { hasLocalFiles(it.modelId) }
        .fold(0L) { total, model -> Math.addExact(total, model.totalBytes) }

    /** 按字节汇总进度；换源重试不倒退，取消后不启动下一项或发布完成回调。 */
    fun prepare(
        cancelled: () -> Boolean,
        prepareModel: (OfflineModelDefinition, (Int) -> Unit) -> Unit,
        progress: (String, Int) -> Unit,
        onPrepared: (String) -> Unit
    ) {
        var completed = 0L
        var lastProgress = 0
        fun checkCancelled() {
            if (cancelled()) throw CancellationException("已取消模型准备")
        }
        for (model in models) {
            checkCancelled()
            prepareModel(model) { value ->
                checkCancelled()
                val bytes = completed + model.totalBytes * value.coerceIn(0, 100) / 100
                lastProgress = maxOf(lastProgress, (bytes * 100 / totalBytes).toInt().coerceAtMost(99))
                progress(model.modelId, lastProgress)
            }
            checkCancelled()
            completed += model.totalBytes
            lastProgress = (completed * 100 / totalBytes).toInt()
            progress(model.modelId, lastProgress)
            onPrepared(model.modelId)
        }
    }

    companion object {
        fun groups(definitions: List<OfflineModelDefinition>): List<OfflineModelGroup> {
            val available = definitions.map { it.modelId }.toSet()
            val voice = listOf(
                OfflineModelGroup("voice-tts", "TTS", listOf("tts"), true),
                OfflineModelGroup("voice-asr", "ASR/声纹", listOf("sensevoice", "voiceprint"), true)
            ).map { it.copy(modelIds = it.modelIds.filter(available::contains)) }.filter { it.modelIds.isNotEmpty() }
            val grouped = voice.flatMap { it.modelIds }.toSet()
            return voice + definitions.filterNot { it.modelId in grouped }.map {
                OfflineModelGroup(it.modelId, it.modelId, listOf(it.modelId))
            }
        }
    }
}

/** 首次提示同时等待服务健康和有效显示页；本机持久化标记由Activity负责。 */
internal class OfflineVoiceFirstRunState {
    var nodeReady = false
    var displayReady = false
    var prompted = false

    /** 只有前台实际展示成功，或完整缓存无需提示时，才消耗首次机会。 */
    fun tryPrompt(offline: Boolean, updateOnly: Boolean, resumed: Boolean,
        needsPreparation: Boolean, showPrompt: () -> Boolean): Boolean {
        if (!offline || !updateOnly || !resumed || !nodeReady || !displayReady || prompted) return false
        if (needsPreparation && !showPrompt()) return false
        prompted = true
        return true
    }
}
