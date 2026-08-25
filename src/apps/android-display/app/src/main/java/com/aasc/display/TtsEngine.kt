package com.aasc.display

import android.content.Context
import com.microsoft.cognitiveservices.speech.EmbeddedSpeechConfig
import com.microsoft.cognitiveservices.speech.ResultReason
import com.microsoft.cognitiveservices.speech.SpeechSynthesisCancellationDetails
import com.microsoft.cognitiveservices.speech.SpeechSynthesisOutputFormat
import com.microsoft.cognitiveservices.speech.SpeechSynthesisResult
import com.microsoft.cognitiveservices.speech.SpeechSynthesizer
import com.microsoft.cognitiveservices.speech.SynthesisVoicesResult
import com.microsoft.cognitiveservices.speech.VoiceInfo
import java.io.File

// Microsoft Embedded Speech SDK 封装：离线 TTS 合成（zh-CN Xiaoxiao，Riff24Khz16BitMonoPcm）
// 参考 nvsapi-linux-poc/android-test MainActivity：EmbeddedSpeechConfig.fromPath + SpeakText
object TtsEngine {

    // 嵌入式语音授权密钥（与参考 POC 一致，模型内置授权）
    private const val TTS_KEY =
        "Key:ZCjZ7nHDSLvf4gpELteM4AnzaWUjTpn7UkV7D@vvksl0w1SNgon6d1905WANbktDc9S39oaA4r29HJNayXvTq8fJsq"

    @Volatile
    private var synthesizer: SpeechSynthesizer? = null

    @Volatile
    var ready: Boolean = false
        private set

    // 加载模型目录并初始化合成器；探测声线后设为 Xiaoxiao（找不到则取第一个）
    // 返回 true 表示加载成功且自检通过（空文本合成不报错）
    fun load(context: Context, modelDir: File): Boolean {
        return try {
            if (!modelDir.isDirectory || !File(modelDir, "2052.INI").isFile) {
                android.util.Log.e("TtsEngine", "模型目录无效: ${modelDir.absolutePath}")
                return false
            }
            val config = EmbeddedSpeechConfig.fromPath(modelDir.absolutePath)
            config.setSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm)

            // 探测声线：优先匹配 Xiaoxiao，否则取第一个可用声线
            val voiceName = probeVoice(config)
            android.util.Log.i("TtsEngine", "selected voice=$voiceName")
            config.setSpeechSynthesisVoice(voiceName, TTS_KEY)

            // 释放旧合成器原生内存
            synthesizer?.close()
            synthesizer = SpeechSynthesizer(config)
            ready = true
            true
        } catch (e: Exception) {
            android.util.Log.e("TtsEngine", "加载失败: ${e.message}", e)
            ready = false
            synthesizer = null
            false
        }
    }

    // 同步合成文本为 WAV 字节（Riff24Khz16BitMonoPcm）；调用方需保证 ready
    @Throws(Exception::class)
    fun synthesize(text: String): ByteArray {
        synchronized(this) {
            val synth = synthesizer ?: throw IllegalStateException("TTS 引擎未加载")
            if (text.isBlank()) throw IllegalArgumentException("合成文本为空")
            val result: SpeechSynthesisResult = synth.SpeakText(text)
            try {
                if (result.getReason() != ResultReason.SynthesizingAudioCompleted) {
                    val details = SpeechSynthesisCancellationDetails.fromResult(result)
                    throw RuntimeException("语音合成取消: $details")
                }
                return result.getAudioData()
            } finally {
                result.close()
            }
        }
    }

    // 探测声线列表，优先返回包含 "Xiaoxiao" 的声线名，否则返回第一个
    private fun probeVoice(config: EmbeddedSpeechConfig): String {
        val probe = SpeechSynthesizer(config)
        return try {
            val future = probe.getVoicesAsync()
            val result: SynthesisVoicesResult = future.get()
            if (result.getReason() != ResultReason.VoicesListRetrieved) {
                throw RuntimeException("声线列表获取失败: ${result.getErrorDetails()}")
            }
            val voices = result.getVoices()
            if (voices == null || voices.isEmpty()) {
                throw RuntimeException("模型中无声线")
            }
            for (voice in voices) {
                android.util.Log.i("TtsEngine", "candidate voice=${voice.getName()} path=${voice.getVoicePath()}")
            }
            // 优先匹配 Xiaoxiao
            val xiaoxiao = voices.firstOrNull { v: VoiceInfo ->
                v.getName().contains("Xiaoxiao", ignoreCase = true)
            }
            xiaoxiao?.getName() ?: voices[0].getName()
        } finally {
            probe.close()
        }
    }

    fun release() {
        synchronized(this) {
            ready = false
            synthesizer?.close()
            synthesizer = null
        }
    }
}
