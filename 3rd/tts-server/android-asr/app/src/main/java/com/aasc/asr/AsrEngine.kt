package com.aasc.asr

import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig
import java.io.File

// sherpa-onnx SenseVoice 一次性识别封装，模型使用 APK 私有目录绝对路径。
class AsrEngine {
    @Volatile
    private var recognizer: OfflineRecognizer? = null

    val isLoaded: Boolean get() = recognizer != null

    @Synchronized
    fun load(modelFile: File, tokensFile: File): Boolean {
        return try {
            val config = OfflineRecognizerConfig(
                featConfig = FeatureConfig(sampleRate = 16000),
                modelConfig = OfflineModelConfig(
                    senseVoice = OfflineSenseVoiceModelConfig(
                        model = modelFile.absolutePath,
                        language = "auto",
                        useInverseTextNormalization = true
                    ),
                    tokens = tokensFile.absolutePath,
                    numThreads = 1,
                    debug = false,
                    provider = "cpu"
                )
            )
            recognizer?.release()
            recognizer = OfflineRecognizer(null, config)
            true
        } catch (_: Exception) {
            recognizer = null
            false
        }
    }

    @Synchronized
    fun recognize(samples: FloatArray): String {
        val current = recognizer ?: throw IllegalStateException("ASR 模型未加载")
        require(samples.isNotEmpty()) { "没有可识别的音频" }
        val stream = current.createStream()
        return try {
            stream.acceptWaveform(samples, 16000)
            current.decode(stream)
            current.getResult(stream).text.trim()
        } finally {
            stream.release()
        }
    }
}
