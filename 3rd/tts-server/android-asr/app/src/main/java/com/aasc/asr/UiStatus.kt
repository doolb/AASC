package com.aasc.asr

// 集中生成界面文案，确保手动识别和 HTTP 识别的耗时语义一致。
object UiStatus {
    fun result(text: String, elapsedMs: Long): String = "识别完成，用时 ${elapsedMs} ms\n$text"

    fun validate(samples: FloatArray): String = when {
        samples.isEmpty() -> "没有可识别的音频"
        samples.size > AudioRecorder.SAMPLE_RATE * 60 -> "音频长度超过 60 秒"
        else -> ""
    }

    // 原生页面用多行文本呈现注册结果，避免用户只能从日志中确认注册是否成功。
    fun voiceprintRegistration(result: VoiceprintRegistrationResult): String = buildString {
        appendLine("注册成功：${result.name}")
        appendLine("声纹模型：${result.modelName}")
        appendLine("embedding 维度：${result.embeddingDim}")
        appendLine("声纹降噪：${enabledLabel(result.voiceprintDenoise)}")
        appendLine("声纹降噪耗时：${result.voiceprintDenoiseMs} ms")
        appendLine("总耗时：${result.elapsedMs} ms")
    }

    // 声纹测试结果同时包含整体匹配信息和每个分段的信息，未识别 speaker 也必须显式展示。
    fun voiceprintResult(result: VoiceprintTestResult): String = buildString {
        appendLine("模式：${result.mode.name}")
        appendLine("声纹模型：${result.modelName}")
        appendLine("ASR 文本：${result.text.ifBlank { "（空）" }}")
        appendLine("匹配声纹：${result.matchedSpeaker ?: "未匹配"}")
        appendLine("相似度：${score(result.similarityScore)}")
        appendLine("阈值：${result.threshold}")
        appendLine("ASR 降噪：${enabledLabel(result.asrDenoise)}，耗时 ${result.asrDenoiseMs} ms")
        appendLine("声纹降噪：${enabledLabel(result.voiceprintDenoise)}，耗时 ${result.voiceprintDenoiseMs} ms")
        appendLine("总耗时：${result.elapsedMs} ms")
        appendLine(
            "阶段耗时：diarization=${result.diarizationMs} ms，" +
                "embedding=${result.embeddingMs} ms，asr=${result.asrMs} ms"
        )
        if (result.segments.isEmpty()) {
            appendLine("分段：无")
        } else {
            result.segments.forEachIndexed { index, segment ->
                appendLine(
                    "分段 ${index + 1}：start=${segment.start}, end=${segment.end}, " +
                        "clusterId=${segment.clusterId}, speaker=${segment.speaker ?: "未识别"}, " +
                        "similarityScore=${score(segment.similarityScore)}, " +
                        "text=${segment.text.ifBlank { "（空）" }}, error=${segment.error ?: "无"}"
                )
            }
        }
    }

    private fun enabledLabel(enabled: Boolean): String = if (enabled) "开启" else "关闭"

    private fun score(value: Float?): String = value?.toString() ?: "null"
}
