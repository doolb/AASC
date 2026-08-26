package com.aasc.asr

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean

data class RecognitionResult(val text: String, val elapsedMs: Long)

class AsrBusyException : IllegalStateException("识别服务忙，请稍后重试")

// 统一管理 UI 和 HTTP 识别，保证模型不会被并发调用，并只统计真正的识别阶段耗时。
class AsrCoordinator(private val engine: AsrEngine) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)

    fun submit(samples: FloatArray, mode: CpuMode): Future<RecognitionResult> {
        validateSamples(samples)
        if (!busy.compareAndSet(false, true)) throw AsrBusyException()
        return executor.submit<RecognitionResult> {
            try {
                CpuAffinity.apply(mode)
                val start = System.nanoTime()
                val text = engine.recognize(samples)
                RecognitionResult(text, (System.nanoTime() - start) / 1_000_000L)
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
