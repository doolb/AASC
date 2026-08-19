package com.aasc.display

import android.content.Context
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig
import java.io.File

// sherpa-onnx OfflineRecognizer 封装（SenseVoice int8，与服务器 asr-service.js 同配置对齐）
// 注意：AAR 的真实构造签名与最初计划有出入，已按 javap 实测调整（详见 task-4-report.md）：
//   1) 外部私有目录使用绝对路径加载模型时，AssetManager 必须传 null；load 保留 Context 参数以兼容现有调用接口
//   2) 特征配置类名是 FeatureConfig（不是 FeatureExtractorConfig）
//   3) useInverseTextNormalization 是 boolean（不是 int 1）
//   4) decode(stream) 返回 void，结果用 getResult(stream).text 取
//   5) OfflineStream 没有 inputFinished()；stream 有 release()，识别完显式释放
object AsrEngine {
    private var recognizer: OfflineRecognizer? = null

    val isLoaded: Boolean get() = recognizer != null

    // 加载模型，失败返回 false 不抛异常（由调用方做损坏清理）
    // 模型和 tokens 位于 APK 私有目录并使用绝对路径，AssetManager 必须传 null。
    // 保留 context 参数是为了兼容现有 AsrModelManager 调用接口，不持有 Context 引用。
    // synchronized 与 recognize 互斥：避免并发时 load 释放原生 recognizer 导致 recognize 读已释放句柄（use-after-free）
    @Suppress("UNUSED_PARAMETER")
    fun load(context: Context, modelFile: File, tokensFile: File): Boolean {
        synchronized(this) {
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
                // 重载时释放旧引擎占用的原生内存
                recognizer?.release()
                recognizer = OfflineRecognizer(null, config)
                true
            } catch (e: Exception) {
                recognizer = null
                false
            }
        }
    }

    // 一次性识别：输入 16kHz mono Float32 样本，输出文本（空输入/未加载抛异常）
    // synchronized 与 load 互斥：保证整个识别过程期间 recognizer 不被并发 release
    @Throws(Exception::class)
    fun recognize(samples: FloatArray): String {
        synchronized(this) {
            val rec = recognizer ?: throw IllegalStateException("ASR 引擎未加载")
            if (samples.isEmpty()) throw IllegalArgumentException("音频数据为空")
            val stream = rec.createStream()
            try {
                stream.acceptWaveform(samples, 16000)
                rec.decode(stream)
                return rec.getResult(stream).text.trim()
            } finally {
                // OfflineStream 有原生内存，识别完显式 release（比依赖 recognizer/finalize 可靠）
                stream.release()
            }
        }
    }
}
