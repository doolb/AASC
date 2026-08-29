package com.aasc.display

import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean

class AsrEnginePool private constructor(
    private val slots: List<Slot>,
    private val idleSlots: LinkedBlockingQueue<Slot>,
    private val affinityApplier: (Long) -> Boolean
) {
    interface RecognizerFactory {
        fun create(modelFile: File, tokensFile: File, language: String): Recognizer
    }

    interface Recognizer {
        @Throws(Exception::class)
        fun recognize(samples: FloatArray): String

        fun release()
    }

    companion object {
        fun configure(
            policy: CpuPolicy,
            modelFile: File,
            tokensFile: File,
            language: String = "auto",
            slotCountOverride: Int? = null,
            recognizerFactory: RecognizerFactory = SherpaRecognizerFactory,
            affinityApplier: (Long) -> Boolean = CpuAffinity::applyCurrentThread
        ): AsrEnginePool {
            val createdSlots = mutableListOf<Slot>()
            return try {
                val slotCount = maxOf(1, slotCountOverride ?: policy.totalCoreCount)
                val masks = slotMasks(policy, slotCount)
                for (index in 0 until slotCount) {
                    val recognizer = recognizerFactory.create(modelFile, tokensFile, language)
                    createdSlots += Slot(index, masks[index], recognizer)
                }
                AsrEnginePool(
                    slots = createdSlots.toList(),
                    idleSlots = LinkedBlockingQueue(createdSlots),
                    affinityApplier = affinityApplier
                )
            } catch (e: Throwable) {
                for (slot in createdSlots) {
                    slot.release()
                }
                throw e
            }
        }

        private fun slotMasks(policy: CpuPolicy, slotCount: Int): List<Long> {
            val selected = policy.selectedCpus
            if (selected.isEmpty()) return List(slotCount) { 0L }
            return selected.map { cpuId -> 1L shl cpuId }
        }
    }

    private val retired = AtomicBoolean(false)
    private val lifecycleLock = Any()
    private var activeUsers = 0

    @Throws(Exception::class)
    fun recognize(samples: FloatArray): String {
        retain()
        return try {
            recognizeRetained(samples)
        } finally {
            releaseRetain()
        }
    }

    internal fun retain(): AsrEnginePool {
        synchronized(lifecycleLock) {
            activeUsers += 1
            return this
        }
    }

    internal fun releaseRetain() {
        synchronized(lifecycleLock) {
            activeUsers = (activeUsers - 1).coerceAtLeast(0)
            if (retired.get() && activeUsers == 0) {
                releaseIdleSlots()
            }
        }
    }

    @Throws(Exception::class)
    internal fun recognizeRetained(samples: FloatArray): String {
        val slot = idleSlots.take()
        return try {
            slot.recognize(samples, affinityApplier)
        } finally {
            returnOrRelease(slot)
        }
    }

    fun retire() {
        if (!retired.compareAndSet(false, true)) return
        synchronized(lifecycleLock) {
            if (activeUsers == 0) {
                releaseIdleSlots()
            }
        }
    }

    private fun returnOrRelease(slot: Slot) {
        synchronized(lifecycleLock) {
            if (retired.get() && activeUsers <= 1) {
                slot.release()
                return
            }
            // retired 后仍可能有已经 retain、但还阻塞在 idleSlots.take() 的旧请求；
            // 此时必须把完成的 slot 放回队列服务旧请求，最后一个 retained 调用退出时再统一释放。
            idleSlots.offer(slot)
        }
    }

    private fun releaseIdleSlots() {
        val drained = mutableListOf<Slot>()
        idleSlots.drainTo(drained)
        for (slot in drained) {
            slot.release()
        }
    }

    private class Slot(
        private val id: Int,
        private val cpuMask: Long,
        private val recognizer: Recognizer
    ) {
        private val released = AtomicBoolean(false)
        private val executor: ExecutorService = Executors.newSingleThreadExecutor { task ->
            Thread(task, "aasc-asr-slot-$id")
        }

        @Throws(Exception::class)
        fun recognize(samples: FloatArray, affinityApplier: (Long) -> Boolean): String {
            val future = executor.submit(Callable {
                // affinity 是性能约束，不是正确性约束；失败时 CpuAffinity 自身只记录日志并回退默认调度。
                affinityApplier(cpuMask)
                recognizer.recognize(samples)
            })
            var interrupted = false
            try {
                while (true) {
                    try {
                        return future.get()
                    } catch (_: InterruptedException) {
                        // 外层 60 秒超时可能打断等待线程，但 native recognizer 未必能立即停止；
                        // 继续等到本槽真实完成后再归还，避免同一个 recognizer 被并发复用。
                        interrupted = true
                    } catch (e: ExecutionException) {
                        val cause = e.cause
                        when (cause) {
                            is Exception -> throw cause
                            else -> throw RuntimeException(cause)
                        }
                    }
                }
            } finally {
                if (interrupted) {
                    Thread.currentThread().interrupt()
                }
            }
        }

        fun release() {
            if (!released.compareAndSet(false, true)) return
            try {
                recognizer.release()
            } finally {
                executor.shutdownNow()
            }
        }
    }

    private object SherpaRecognizerFactory : RecognizerFactory {
        override fun create(modelFile: File, tokensFile: File, language: String): Recognizer {
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
            // 模型文件位于 APK 私有目录，必须传 null AssetManager，让 AAR 走文件系统路径。
            return SherpaRecognizer(OfflineRecognizer(null, config))
        }
    }

    private class SherpaRecognizer(
        private val recognizer: OfflineRecognizer
    ) : Recognizer {
        override fun recognize(samples: FloatArray): String {
            val stream = recognizer.createStream()
            try {
                stream.acceptWaveform(samples, 16000)
                recognizer.decode(stream)
                return recognizer.getResult(stream).text.trim()
            } finally {
                // OfflineStream 持有 native 内存，按请求及时释放。
                stream.release()
            }
        }

        override fun release() {
            recognizer.release()
        }
    }
}
