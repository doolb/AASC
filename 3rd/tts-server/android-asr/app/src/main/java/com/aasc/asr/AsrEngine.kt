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
    private var modelFile: File? = null
    private var tokensFile: File? = null
    private var activeLanguage: String? = null

    val isLoaded: Boolean get() = recognizer != null

    @Synchronized
    fun load(modelFile: File, tokensFile: File, language: String = "auto"): Boolean {
        return try {
            val normalizedLanguage = normalizeLanguage(language)
            val replacement = createRecognizer(modelFile, tokensFile, normalizedLanguage)
            recognizer?.release()
            this.modelFile = modelFile
            this.tokensFile = tokensFile
            recognizer = replacement
            activeLanguage = normalizedLanguage
            true
        } catch (_: Exception) {
            recognizer = null
            this.modelFile = null
            this.tokensFile = null
            activeLanguage = null
            false
        }
    }

    @Synchronized
    fun recognize(samples: FloatArray, language: String = "auto"): String {
        require(samples.isNotEmpty()) { "没有可识别的音频" }
        val normalizedLanguage = normalizeLanguage(language)
        ensureLanguage(normalizedLanguage)
        val current = recognizer ?: throw IllegalStateException("ASR 模型未加载")
        val stream = current.createStream()
        return try {
            stream.acceptWaveform(samples, 16000)
            current.decode(stream)
            current.getResult(stream).text.trim()
        } finally {
            stream.release()
        }
    }

    @Synchronized
    fun release() {
        recognizer?.release()
        recognizer = null
        modelFile = null
        tokensFile = null
        activeLanguage = null
    }

    private fun ensureLanguage(language: String) {
        if (recognizer != null && activeLanguage == language) return
        val currentModelFile = modelFile ?: throw IllegalStateException("ASR 模型未加载")
        val currentTokensFile = tokensFile ?: throw IllegalStateException("ASR 模型未加载")
        val replacement = createRecognizer(currentModelFile, currentTokensFile, language)
        recognizer?.release()
        recognizer = replacement
        activeLanguage = language
    }

    private fun createRecognizer(modelFile: File, tokensFile: File, language: String): OfflineRecognizer {
        val config = OfflineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = 16000),
            modelConfig = OfflineModelConfig(
                senseVoice = OfflineSenseVoiceModelConfig(
                    model = modelFile.absolutePath,
                    language = language,
                    useInverseTextNormalization = true
                ),
                tokens = tokensFile.absolutePath,
                numThreads = 1,
                debug = false,
                provider = "cpu"
            )
        )
        return OfflineRecognizer(null, config)
    }

    private fun normalizeLanguage(language: String): String = when (language.lowercase()) {
        "auto", "zh", "en" -> language.lowercase()
        else -> throw IllegalArgumentException("ASR language 必须是 auto、zh 或 en")
    }
}
