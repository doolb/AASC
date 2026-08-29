package com.aasc.display

// 快速多段的人数参数：0 交给 Sherpa 自动估计，1～5 为已知人数。
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
