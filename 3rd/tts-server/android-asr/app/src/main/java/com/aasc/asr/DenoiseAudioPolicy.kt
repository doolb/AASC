package com.aasc.asr

import java.util.concurrent.TimeUnit

data class PreparedDenoiseAudio(
    val samples: FloatArray,
    val enabled: Boolean,
    val elapsedMs: Long
)

data class PreparedDenoisePair(
    val asr: PreparedDenoiseAudio,
    val voiceprint: PreparedDenoiseAudio
)

// 统一准备一次请求使用的音频，确保声纹分段、匹配和 ASR 使用同一份降噪结果。
object DenoiseAudioPolicy {
    fun preparePair(
        rawSamples: FloatArray,
        asrEnabled: Boolean,
        voiceprintEnabled: Boolean,
        processor: () -> FloatArray
    ): PreparedDenoisePair {
        val asr = prepare(rawSamples, asrEnabled, processor)
        val voiceprint = if (asrEnabled == voiceprintEnabled) {
            asr
        } else {
            prepare(rawSamples, voiceprintEnabled, processor)
        }
        return PreparedDenoisePair(asr = asr, voiceprint = voiceprint)
    }

    fun prepare(
        rawSamples: FloatArray,
        enabled: Boolean,
        processor: () -> FloatArray
    ): PreparedDenoiseAudio {
        if (!enabled) return PreparedDenoiseAudio(rawSamples, false, 0)
        val started = System.nanoTime()
        val samples = processor()
        return PreparedDenoiseAudio(
            samples = samples,
            enabled = true,
            elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)
        )
    }
}
