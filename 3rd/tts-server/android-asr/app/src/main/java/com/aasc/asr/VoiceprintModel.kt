package com.aasc.asr

// 独立测试 APK 支持的声纹 embedding 模型；默认使用当前已验证的 ERes2Net-base。
enum class VoiceprintModel(
    val id: String,
    val displayName: String,
    val embeddingFileName: String
) {
    ERES2NET_BASE(
        id = "eres2net-base",
        displayName = "ERes2Net-base",
        embeddingFileName = "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
    ),
    ERES2NET_LARGE(
        id = "eres2net-large",
        displayName = "ERes2Net-large",
        embeddingFileName = "3dspeaker_speech_eres2net_large_sv_zh-cn_3dspeaker_16k.onnx"
    ),
    ERES2NET_V2(
        id = "eres2netv2",
        displayName = "ERes2NetV2",
        embeddingFileName = "3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx"
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
    FP32("fp32", "FP32"),
    INT8("int8", "INT8");

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
        get() = when (precision) {
            VoiceprintPrecision.FP32 -> model.embeddingFileName
            VoiceprintPrecision.INT8 -> "${model.embeddingFileName.removeSuffix(".onnx")}_int8.onnx"
        }
}
