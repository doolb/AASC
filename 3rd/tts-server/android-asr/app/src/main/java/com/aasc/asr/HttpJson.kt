package com.aasc.asr

// HTTP 接口统一使用手写 JSON，避免为测试服务引入额外依赖，并确保错误消息正确转义。
object HttpJson {
    fun success(text: String, elapsedMs: Long): String =
        "{\"success\":true,\"text\":\"${escape(text)}\",\"elapsedMs\":$elapsedMs}"

    fun success(text: String, elapsedMs: Long, denoise: Boolean, denoiseMs: Long): String =
        "{\"success\":true,\"text\":\"${escape(text)}\",\"elapsedMs\":$elapsedMs," +
            "\"denoise\":$denoise,\"denoiseMs\":$denoiseMs}"

    fun error(message: String, elapsedMs: Long = 0): String =
        "{\"success\":false,\"error\":\"${escape(message)}\",\"elapsedMs\":$elapsedMs}"

    fun health(modelReady: Boolean, serviceRunning: Boolean, cpuMode: CpuMode, streamingReady: Boolean): String =
        "{\"modelReady\":$modelReady,\"streamingReady\":$streamingReady,\"httpRunning\":$serviceRunning,\"cpuMode\":\"${cpuMode.name}\"}"

    fun streamingPartial(text: String): String = streamingText("partial", text)

    fun streamingFinal(text: String): String = streamingText("final", text)

    fun streamingError(message: String): String =
        "{\"type\":\"error\",\"error\":\"${escape(message)}\"}"

    fun voiceprintStatus(ready: Boolean, embeddingDim: Int, speakers: List<String>, threshold: Float): String {
        val names = speakers.joinToString(",") { "\"${escape(it)}\"" }
        return "{\"modelReady\":$ready,\"embeddingDim\":$embeddingDim,\"registeredSpeakers\":${speakers.size},\"speakers\":[$names],\"threshold\":${number(threshold)},\"modes\":[\"SHERPA_SINGLE\",\"SHERPA_MULTI\",\"SHERPA_MULTI_FAST\"]}"
    }

    fun voiceprintRegistration(result: VoiceprintRegistrationResult): String =
        "{\"success\":true,\"name\":\"${escape(result.name)}\",\"embeddingDim\":${result.embeddingDim}," +
            "\"denoise\":${result.denoise},\"denoiseMs\":${result.denoiseMs}," +
            "\"voiceprintDenoise\":${result.voiceprintDenoise}," +
            "\"voiceprintDenoiseMs\":${result.voiceprintDenoiseMs}}"

    fun voiceprintResult(result: VoiceprintTestResult): String {
        val segments = result.segments.joinToString(",") { segment ->
            "{\"start\":${segment.start},\"end\":${segment.end},\"clusterId\":${segment.clusterId}," +
                "\"speaker\":${nullableString(segment.speaker)},\"text\":\"${escape(segment.text)}\"," +
                "\"similarityScore\":${nullableNumber(segment.similarityScore)}," +
                "\"error\":${nullableString(segment.error)}}"
        }
        return "{\"success\":true,\"mode\":\"${result.mode.name}\",\"denoise\":${result.denoise},\"denoiseMs\":${result.denoiseMs}," +
            "\"asrDenoise\":${result.asrDenoise},\"asrDenoiseMs\":${result.asrDenoiseMs}," +
            "\"voiceprintDenoise\":${result.voiceprintDenoise},\"voiceprintDenoiseMs\":${result.voiceprintDenoiseMs}," +
            "\"embeddingDim\":${result.embeddingDim}," +
            "\"matchedSpeaker\":${nullableString(result.matchedSpeaker)}," +
            "\"similarityScore\":${nullableNumber(result.similarityScore)},\"threshold\":${number(result.threshold)}," +
            "\"text\":\"${escape(result.text)}\"," +
            "\"segments\":[$segments],\"elapsedMs\":${result.elapsedMs}," +
            "\"diarizationMs\":${result.diarizationMs},\"embeddingMs\":${result.embeddingMs},\"asrMs\":${result.asrMs}}"
    }

    private fun escape(value: String): String = buildString(value.length + 8) {
        value.forEach { character ->
            when (character) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (character.code < 0x20) append(" ") else append(character)
            }
        }
    }

    private fun nullableString(value: String?): String = value?.let { "\"${escape(it)}\"" } ?: "null"

    private fun nullableNumber(value: Float?): String = value?.let(::number) ?: "null"

    private fun number(value: Float): String = value.toString()

    private fun streamingText(type: String, text: String): String =
        "{\"type\":\"$type\",\"text\":\"${escape(text)}\"}"
}
