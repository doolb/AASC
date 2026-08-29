package com.aasc.asr

import java.util.concurrent.TimeUnit

data class PreparedDenoiseAudio(
    val samples: FloatArray,
    val enabled: Boolean,
    val elapsedMs: Long
)

// 统一准备一次请求使用的音频，确保声纹分段、匹配和 ASR 使用同一份降噪结果。
object DenoiseAudioPolicy {
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
