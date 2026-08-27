package com.aasc.asr

// 独立测试 APK 只保留两种 Sherpa 声纹流程，统一由 HTTP 参数和网页下拉框使用此枚举。
enum class VoiceprintMode {
    SHERPA_SINGLE,
    SHERPA_MULTI;

    companion object {
        fun parse(value: String?): VoiceprintMode? = values().firstOrNull {
            it.name.equals(value?.trim(), ignoreCase = true)
        }
    }
}
