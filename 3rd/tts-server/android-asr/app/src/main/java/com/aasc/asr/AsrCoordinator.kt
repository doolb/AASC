package com.aasc.asr

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean

data class RecognitionResult(
    val text: String,
    val elapsedMs: Long,
    val denoise: Boolean = false,
    val denoiseMs: Long = 0
)

class AsrBusyException : IllegalStateException("识别服务忙，请稍后重试")

// 统一管理 UI 和 HTTP 识别，保证模型不会被并发调用，并只统计真正的识别阶段耗时。
class AsrCoordinator(
    private val engine: AsrEngine,
    private val denoiseEngine: SherpaDenoiseEngine? = null
) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)

    fun submit(
        samples: FloatArray,
        mode: CpuMode,
        languageMode: AsrLanguageMode = AsrLanguageMode.AUTO,
        denoise: Boolean = false
    ): Future<RecognitionResult> {
        validateSamples(samples)
        if (!busy.compareAndSet(false, true)) throw AsrBusyException()
        return executor.submit<RecognitionResult> {
            try {
                CpuAffinity.apply(mode)
                val prepared = DenoiseAudioPolicy.prepare(samples, denoise) {
                    denoiseEngine?.process(samples)
                        ?: throw IllegalStateException("降噪模型尚未就绪")
                }
                val start = System.nanoTime()
                val text = engine.recognize(prepared.samples, languageMode.engineLanguage)
                RecognitionResult(
                    text = text,
                    elapsedMs = (System.nanoTime() - start) / 1_000_000L,
                    denoise = prepared.enabled,
                    denoiseMs = prepared.elapsedMs
                )
            } finally {
                busy.set(false)
            }
        }
    }

    fun isBusy(): Boolean = busy.get()

    fun shutdown() {
        executor.shutdownNow()
    }

    companion object {
        @JvmStatic
        fun validateSamples(samples: FloatArray) {
            require(samples.isNotEmpty()) { "没有可识别的音频" }
            require(samples.size <= 16000 * 60) { "音频长度超过 60 秒" }
        }

        @JvmStatic
        fun measureForTest(recognizer: () -> String): RecognitionResult {
            val start = System.nanoTime()
            val text = recognizer()
            return RecognitionResult(text, (System.nanoTime() - start) / 1_000_000L)
        }
    }
}
