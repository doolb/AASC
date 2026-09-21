package com.aasc.asr

import kotlin.math.abs

/**
 * 把 PCM 音频压缩为适合绘图的音量包络。
 *
 * 每个点代表约 100 ms 音频块内的归一化峰值，既能保留完整时间轴，又不会为图表复制整段 PCM。
 */
object AudioVolumeEnvelope {
    const val DEFAULT_WINDOW_SAMPLES = AudioRecorder.SAMPLE_RATE / 10

    fun fromPcm16(buffer: ShortArray, count: Int): Float {
        val actualCount = count.coerceIn(0, buffer.size)
        if (actualCount == 0) return 0.0f
        var peak = 0
        for (index in 0 until actualCount) {
            peak = maxOf(peak, abs(buffer[index].toInt()))
        }
        return (peak / 32768.0f).coerceIn(0.0f, 1.0f)
    }

    fun fromSamples(samples: FloatArray, windowSamples: Int = DEFAULT_WINDOW_SAMPLES): List<Float> {
        if (samples.isEmpty()) return emptyList()
        val safeWindow = windowSamples.coerceAtLeast(1)
        val points = ArrayList<Float>((samples.size + safeWindow - 1) / safeWindow)
        var start = 0
        while (start < samples.size) {
            val end = minOf(start + safeWindow, samples.size)
            var peak = 0.0f
            for (index in start until end) {
                peak = maxOf(peak, abs(samples[index]))
            }
            points += peak.coerceIn(0.0f, 1.0f)
            start = end
        }
        return points
    }
}
