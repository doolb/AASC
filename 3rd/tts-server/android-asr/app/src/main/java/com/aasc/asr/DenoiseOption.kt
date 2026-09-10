package com.aasc.asr

data class DenoiseFlags(
    val asrDenoise: Boolean,
    val voiceprintDenoise: Boolean
)

// 统一解析网页查询参数，避免注册和测试接口对开关值的解释不一致。
object DenoiseOption {
    fun parse(value: String?): Boolean = when (value?.trim()?.lowercase()) {
        "1", "true", "on", "yes" -> true
        else -> false
    }

    fun resolve(asrValue: String?, voiceprintValue: String?, legacyValue: String?): DenoiseFlags {
        val legacy = parse(legacyValue)
        return DenoiseFlags(
            asrDenoise = asrValue?.let(::parse) ?: legacy,
            voiceprintDenoise = voiceprintValue?.let(::parse) ?: legacy
        )
    }
}
