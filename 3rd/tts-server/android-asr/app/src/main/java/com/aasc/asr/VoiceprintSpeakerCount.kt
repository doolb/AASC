package com.aasc.asr

// 声纹多人测试的人数参数：0 表示由 Sherpa 自动估计，1-5 表示已知的实际说话人数。
object VoiceprintSpeakerCount {
    const val AUTO = 0
    const val MIN = 1
    const val MAX = 5

    fun parse(value: String?): Int? {
        val normalized = value?.trim()
        if (normalized.isNullOrEmpty() || normalized.equals("AUTO", ignoreCase = true)) return AUTO
        return normalized.toIntOrNull()?.takeIf { it in MIN..MAX }
    }
}
