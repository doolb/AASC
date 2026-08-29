package com.aasc.display

import android.content.Context
import com.microsoft.cognitiveservices.speech.EmbeddedSpeechConfig
import com.microsoft.cognitiveservices.speech.ResultReason
import com.microsoft.cognitiveservices.speech.SpeechSynthesisOutputFormat
import com.microsoft.cognitiveservices.speech.SpeechSynthesizer
import com.microsoft.cognitiveservices.speech.SynthesisVoicesResult
import com.microsoft.cognitiveservices.speech.VoiceInfo
import java.io.File

// Microsoft Embedded Speech SDK 封装：离线 TTS 合成（zh-CN Xiaoxiao，Riff24Khz16BitMonoPcm）
// 使用 EmbeddedSpeechConfig.fromPath 和 SpeakText 完成离线语音合成
object TtsEngine {

    // 嵌入式语音授权密钥（与参考 POC 一致，模型内置授权）
    private const val TTS_KEY =
        "Key:ZCjZ7nHDSLvf4gpELteM4AnzaWUjTpn7UkV7D@vvksl0w1SNgon6d1905WANbktDc9S39oaA4r29HJNayXvTq8fJsq"

    private val lock = Any()
    private var currentPool: TtsEnginePool? = null
    private var currentPolicy: CpuPolicy = CpuCluster.detect().policy(bigCoreCount = 1, littleCoreCount = 1)
    private var currentModelDir: File? = null
    private var currentVoiceName: String? = null

    @Volatile
    var ready: Boolean = false
        private set

    // 加载模型目录并初始化合成器；探测声线后设为 Xiaoxiao（找不到则取第一个）
    // 返回 true 表示加载成功且自检通过（空文本合成不报错）
    @Suppress("UNUSED_PARAMETER")
    fun load(context: Context, modelDir: File): Boolean {
        return try {
            if (!modelDir.isDirectory || !File(modelDir, "2052.INI").isFile) {
                android.util.Log.e("TtsEngine", "模型目录无效: ${modelDir.absolutePath}")
                return false
            }
            // 探测声线：优先匹配 Xiaoxiao，否则取第一个可用声线
            val voiceName = probeVoice(modelDir)
            android.util.Log.i("TtsEngine", "selected voice=$voiceName")
            val policy = synchronized(lock) { currentPolicy }
            val newPool = createPool(policy, modelDir, voiceName) ?: return false
            synchronized(lock) {
                replacePool(newPool, modelDir, voiceName)
                ready = true
                true
            }
        } catch (e: Exception) {
            android.util.Log.e("TtsEngine", "加载失败: ${e.message}", e)
            ready = false
            false
        }
    }

    fun configurePolicy(policy: CpuPolicy): Boolean {
        val modelSnapshot: File
        val voiceSnapshot: String
        synchronized(lock) {
            if (currentPolicy == policy) {
                return true
            }
            val loadedModel = currentModelDir
            val loadedVoice = currentVoiceName
            if (currentPool == null || loadedModel == null || loadedVoice == null) {
                currentPolicy = policy
                return true
            }
            modelSnapshot = loadedModel
            voiceSnapshot = loadedVoice
        }

        val newPool = createPool(policy, modelSnapshot, voiceSnapshot) ?: return false
        synchronized(lock) {
            currentPolicy = policy
            replacePool(newPool, modelSnapshot, voiceSnapshot)
            ready = true
        }
        return true
    }

    /** 返回当前 TTS policy 对应的最小桥侧 worker 数，供 NativeBridge 建立有限调度器。 */
    fun currentPolicySlotCount(): Int {
        return synchronized(lock) {
            maxOf(1, currentPolicy.totalCoreCount)
        }
    }

    // 返回当前已生效的 TTS CPU policy，供显示端向服务端回报实际槽位和 affinity。
    fun currentPolicy(): CpuPolicy = synchronized(lock) { currentPolicy }

    // 同步合成文本为 WAV 字节（Riff24Khz16BitMonoPcm）；调用方需保证 ready
    @Throws(Exception::class)
    fun synthesize(text: String): ByteArray {
        if (text.isBlank()) throw IllegalArgumentException("合成文本为空")
        val pool = synchronized(lock) {
            if (!ready) throw IllegalStateException("TTS 引擎未加载")
            (currentPool ?: throw IllegalStateException("TTS 引擎未加载")).retain()
        }
        return try {
            pool.synthesizeRetained(text)
        } finally {
            pool.releaseRetain()
        }
    }

    // 探测声线列表，优先返回包含 "Xiaoxiao" 的声线名，否则返回第一个
    private fun probeVoice(modelDir: File): String {
        val config = EmbeddedSpeechConfig.fromPath(modelDir.absolutePath)
        config.setSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm)
        // 声线探测不需要音频输出，同样显式关闭 SDK 的默认扬声器配置。
        val probe = SpeechSynthesizer(config, null)
        return try {
            val future = probe.getVoicesAsync()
            val result: SynthesisVoicesResult = future.get()
            try {
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
                result.close()
            }
        } finally {
            probe.close()
        }
    }

    private fun createPool(policy: CpuPolicy, modelDir: File, voiceName: String): TtsEnginePool? {
        return try {
            TtsEnginePool.configure(
                policy = policy,
                modelDir = modelDir,
                voiceName = voiceName,
                embeddedKey = TTS_KEY
            )
        } catch (e: Exception) {
            android.util.Log.e("TtsEngine", "TTS pool 构造失败: ${e.message}", e)
            null
        }
    }

    private fun replacePool(newPool: TtsEnginePool, modelDir: File, voiceName: String) {
        val oldPool = currentPool
        currentPool = newPool
        currentModelDir = modelDir
        currentVoiceName = voiceName
        oldPool?.retire()
    }

    fun release() {
        synchronized(lock) {
            ready = false
            val oldPool = currentPool
            currentPool = null
            currentModelDir = null
            currentVoiceName = null
            oldPool?.retire()
        }
    }
}
