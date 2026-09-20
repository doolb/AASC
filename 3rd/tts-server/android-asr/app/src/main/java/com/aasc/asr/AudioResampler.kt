package com.aasc.asr

// 将交错多声道 16-bit PCM 转换为 16kHz 单声道 Float32，使用线性插值保持时长稳定。
object AudioResampler {
    private const val TARGET_SAMPLE_RATE = 16000

    fun toMono16k(audio: PcmAudio): FloatArray {
        require(audio.sampleRate > 0) { "音频采样率无效" }
        require(audio.channels > 0) { "音频声道数无效" }
        require(audio.samples.size % audio.channels == 0) { "音频帧数据不完整" }
        val frameCount = audio.samples.size / audio.channels
        require(frameCount > 0) { "音频数据为空" }
        val mono = FloatArray(frameCount)
        for (frame in 0 until frameCount) {
            var total = 0.0f
            for (channel in 0 until audio.channels) total += audio.samples[frame * audio.channels + channel] / 32768.0f
            mono[frame] = total / audio.channels
        }
        if (audio.sampleRate == TARGET_SAMPLE_RATE) return mono
        return resampleMono(mono, audio.sampleRate, TARGET_SAMPLE_RATE)
    }

    /** 将单声道 Float32 PCM 从任意采样率线性重采样到目标采样率。 */
    fun resampleMono(samples: FloatArray, sourceSampleRate: Int, targetSampleRate: Int): FloatArray {
        require(sourceSampleRate > 0) { "源采样率无效" }
        require(targetSampleRate > 0) { "目标采样率无效" }
        if (samples.isEmpty() || sourceSampleRate == targetSampleRate) return samples
        val outputSize = maxOf(1, ((samples.size.toLong() * targetSampleRate + sourceSampleRate / 2) / sourceSampleRate).toInt())
        val output = FloatArray(outputSize)
        val scale = sourceSampleRate.toDouble() / targetSampleRate
        for (index in output.indices) {
            val sourcePosition = index * scale
            val left = sourcePosition.toInt().coerceIn(0, samples.lastIndex)
            val right = (left + 1).coerceAtMost(samples.lastIndex)
            val fraction = (sourcePosition - left).toFloat()
            output[index] = samples[left] + (samples[right] - samples[left]) * fraction
        }
        return output
    }
}
