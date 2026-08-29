package com.aasc.asr

import com.k2fsa.sherpa.onnx.DenoisedAudio
import com.k2fsa.sherpa.onnx.OfflineSpeechDenoiser
import com.k2fsa.sherpa.onnx.OfflineSpeechDenoiserConfig
import com.k2fsa.sherpa.onnx.OfflineSpeechDenoiserGtcrnModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeechDenoiserModelConfig
import java.io.File

// Sherpa GTCRN 离线降噪封装：每次请求复用一个 native 模型，输入和输出均为 16 kHz Float32。
class SherpaDenoiseEngine {
    private var denoiser: OfflineSpeechDenoiser? = null

    @Volatile
    var isLoaded: Boolean = false
        private set

    @Synchronized
    fun load(modelFile: File): Boolean {
        return try {
            release()
            val modelConfig = OfflineSpeechDenoiserModelConfig()
            modelConfig.gtcrn = OfflineSpeechDenoiserGtcrnModelConfig(modelFile.absolutePath)
            modelConfig.numThreads = 1
            modelConfig.debug = false
            modelConfig.provider = "cpu"
            denoiser = OfflineSpeechDenoiser(
                null,
                OfflineSpeechDenoiserConfig(modelConfig)
            )
            isLoaded = true
            true
        } catch (_: Exception) {
            release()
            false
        }
    }

    @Synchronized
    fun process(samples: FloatArray): FloatArray {
        val current = denoiser ?: throw IllegalStateException("降噪模型尚未就绪")
        require(samples.isNotEmpty()) { "音频数据为空" }
        val result: DenoisedAudio = current.run(samples, SAMPLE_RATE)
        require(result.sampleRate == SAMPLE_RATE) { "降噪输出采样率不匹配" }
        return result.samples
    }

    @Synchronized
    fun release() {
        denoiser?.release()
        denoiser = null
        isLoaded = false
    }

    companion object {
        const val SAMPLE_RATE = 16000
    }
}
