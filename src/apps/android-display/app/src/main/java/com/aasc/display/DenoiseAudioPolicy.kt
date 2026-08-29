package com.aasc.display

import java.util.concurrent.TimeUnit

data class PreparedDenoiseAudio(
    val samples: FloatArray,
    val enabled: Boolean,
    val elapsedMs: Long
)

// 统一请求音频准备流程，确保一条请求的声纹和 ASR 使用同一份降噪结果。
object DenoiseAudioPolicy {
    fun prepare(rawSamples: FloatArray, enabled: Boolean, processor: () -> FloatArray): PreparedDenoiseAudio {
        if (!enabled) return PreparedDenoiseAudio(rawSamples, false, 0)
        val started = System.nanoTime()
        return PreparedDenoiseAudio(
            samples = processor(),
            enabled = true,
            elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)
        )
    }
}
