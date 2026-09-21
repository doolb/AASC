package com.aasc.asr

// 独立测试 APK 暂时只内置当前已验证的 ERes2Net-base FP32 声纹模型。
enum class VoiceprintModel(
    val id: String,
    val displayName: String,
    val embeddingFileName: String
) {
    ERES2NET_BASE(
        id = "eres2net-base",
        displayName = "ERes2Net-base",
        embeddingFileName = "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
    );

    companion object {
        fun fromId(value: String?): VoiceprintModel? {
            val normalized = value?.trim().orEmpty()
            if (normalized.isEmpty()) return null
            return values().firstOrNull { model ->
                model.id.equals(normalized, ignoreCase = true) ||
                    model.name.equals(normalized, ignoreCase = true)
            }
        }
    }

    fun variant(precision: VoiceprintPrecision): VoiceprintModelVariant =
        VoiceprintModelVariant(this, precision)
}

enum class VoiceprintPrecision(
    val id: String,
    val displayName: String
) {
    FP32("fp32", "FP32");

    companion object {
        fun fromId(value: String?): VoiceprintPrecision? {
            val normalized = value?.trim().orEmpty()
            if (normalized.isEmpty()) return FP32
            return values().firstOrNull { precision ->
                precision.id.equals(normalized, ignoreCase = true) ||
                    precision.name.equals(normalized, ignoreCase = true)
            }
        }
    }
}

data class VoiceprintModelVariant(
    val model: VoiceprintModel,
    val precision: VoiceprintPrecision
) {
    val id: String
        get() = "${model.id}-${precision.id}"

    val displayName: String
        get() = "${model.displayName} (${precision.displayName})"

    val embeddingFileName: String
        get() = model.embeddingFileName
}
