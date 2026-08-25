package com.aasc.tts

import android.util.Log
import com.microsoft.cognitiveservices.speech.EmbeddedSpeechConfig
import com.microsoft.cognitiveservices.speech.ResultReason
import com.microsoft.cognitiveservices.speech.SpeechSynthesisCancellationDetails
import com.microsoft.cognitiveservices.speech.SpeechSynthesisOutputFormat
import com.microsoft.cognitiveservices.speech.SpeechSynthesisResult
import com.microsoft.cognitiveservices.speech.SpeechSynthesizer
import com.microsoft.cognitiveservices.speech.SynthesisVoicesResult
import com.microsoft.cognitiveservices.speech.VoiceInfo
import java.io.File

// 单个 Embedded Speech TTS 引擎实例。所有合成操作由调用方的单线程执行器串行提交。
class TtsEngine {
    companion object {
        private const val TAG = "AascTtsEngine"
        // 该授权串与项目现有 Android 原生 TTS 实现保持一致，模型和授权均随 APK 离线分发。
        private const val TTS_KEY =
            "Key:ZCjZ7nHDSLvf4gpELteM4AnzaWUjTpn7UkV7D@vvksl0w1SNgon6d1905WANbktDc9S39oaA4r29HJNayXvTq8fJsq"
    }

    data class SynthesisResult(val audioData: ByteArray, val elapsedMs: Long)

    private var config: EmbeddedSpeechConfig? = null
    private var synthesizer: SpeechSynthesizer? = null

    @Volatile
    var ready: Boolean = false
        private set

    // 从已经复制到应用私有目录的模型初始化引擎，并优先选择 Xiaoxiao 声线。
    fun load(modelDir: File) {
        require(TtsModelFiles.isComplete(modelDir)) { "内置模型文件不完整" }
        synchronized(this) {
            releaseLocked()
            val nextConfig = EmbeddedSpeechConfig.fromPath(modelDir.absolutePath)
            nextConfig.setSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm)
            val voiceName = probeVoice(nextConfig)
            nextConfig.setSpeechSynthesisVoice(voiceName, TTS_KEY)
            // 传入 null 禁用 SDK 默认扬声器输出，只从 SpeechSynthesisResult 取得 WAV 数据。
            val nextSynthesizer = SpeechSynthesizer(nextConfig, null)
            config = nextConfig
            synthesizer = nextSynthesizer
            ready = true
            Log.i(TAG, "离线 TTS 引擎已就绪，声线=$voiceName")
        }
    }

    // 同步生成 WAV 数据，并只统计 SDK SpeakText 阶段的单调时钟耗时。
    fun synthesize(text: String): SynthesisResult {
        synchronized(this) {
            check(ready) { "TTS 引擎尚未就绪" }
            val activeSynthesizer = synthesizer ?: error("TTS 合成器不存在")
            val startedAt = System.nanoTime()
            val result: SpeechSynthesisResult = activeSynthesizer.SpeakText(text)
            val elapsedMs = (System.nanoTime() - startedAt) / 1_000_000L
            try {
                if (result.getReason() != ResultReason.SynthesizingAudioCompleted) {
                    val details = SpeechSynthesisCancellationDetails.fromResult(result)
                    throw IllegalStateException("语音合成取消: $details")
                }
                return SynthesisResult(result.getAudioData(), elapsedMs)
            } finally {
                result.close()
            }
        }
    }

    // 释放 native 合成器、配置句柄和 SDK 声线探测产生的临时资源。
    fun release() {
        synchronized(this) { releaseLocked() }
    }

    private fun releaseLocked() {
        ready = false
        synthesizer?.close()
        synthesizer = null
        config?.close()
        config = null
    }

    // 声线探测器同样显式传入 null，避免启动时短暂打开系统默认扬声器。
    private fun probeVoice(speechConfig: EmbeddedSpeechConfig): String {
        val probe = SpeechSynthesizer(speechConfig, null)
        return try {
            val voicesResult: SynthesisVoicesResult = probe.getVoicesAsync().get()
            try {
                if (voicesResult.getReason() != ResultReason.VoicesListRetrieved) {
                    throw IllegalStateException("声线列表获取失败: ${voicesResult.getErrorDetails()}")
                }
                val voices = voicesResult.getVoices()
                if (voices == null || voices.isEmpty()) throw IllegalStateException("模型中无可用声线")
                val xiaoxiao = voices.firstOrNull { voice: VoiceInfo ->
                    voice.getName().contains("Xiaoxiao", ignoreCase = true)
                }
                return xiaoxiao?.getName() ?: voices[0].getName()
            } finally {
                voicesResult.close()
            }
        } finally {
            probe.close()
        }
    }
}
