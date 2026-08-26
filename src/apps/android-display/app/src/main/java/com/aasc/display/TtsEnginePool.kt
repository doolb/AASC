package com.aasc.display

import com.microsoft.cognitiveservices.speech.EmbeddedSpeechConfig
import com.microsoft.cognitiveservices.speech.ResultReason
import com.microsoft.cognitiveservices.speech.SpeechSynthesisCancellationDetails
import com.microsoft.cognitiveservices.speech.SpeechSynthesisOutputFormat
import com.microsoft.cognitiveservices.speech.SpeechSynthesisResult
import com.microsoft.cognitiveservices.speech.SpeechSynthesizer
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicBoolean

class TtsEnginePool private constructor(
    private val slots: List<Slot>,
    private val idleSlots: LinkedBlockingQueue<Slot>,
    private val admission: Semaphore,
    private val affinityApplier: (Long) -> Boolean
) {
    enum class AudioOutputMode {
        SILENT_WAV
    }

    data class SynthesizerRequest(
        val modelDir: File,
        val voiceName: String,
        val embeddedKey: String,
        val outputMode: AudioOutputMode
    )

    interface SynthesizerFactory {
        @Throws(Exception::class)
        fun create(request: SynthesizerRequest): Synthesizer
    }

    interface Synthesizer {
        @Throws(Exception::class)
        fun synthesize(text: String): ByteArray

        fun release()
    }

    companion object {
        const val OVERLOAD_ERROR_MESSAGE = "TTS 请求过多，请稍后重试"

        fun configure(
            policy: CpuPolicy,
            modelDir: File,
            voiceName: String,
            embeddedKey: String,
            synthesizerFactory: SynthesizerFactory = MicrosoftSynthesizerFactory,
            affinityApplier: (Long) -> Boolean = CpuAffinity::applyCurrentThread
        ): TtsEnginePool {
            val createdSlots = mutableListOf<Slot>()
            return try {
                val slotCount = maxOf(1, policy.totalCoreCount)
                val masks = slotMasks(policy, slotCount)
                for (index in 0 until slotCount) {
                    val synthesizer = synthesizerFactory.create(
                        SynthesizerRequest(
                            modelDir = modelDir,
                            voiceName = voiceName,
                            embeddedKey = embeddedKey,
                            outputMode = AudioOutputMode.SILENT_WAV
                        )
                    )
                    createdSlots += Slot(index, masks[index], synthesizer)
                }
                TtsEnginePool(
                    slots = createdSlots.toList(),
                    idleSlots = LinkedBlockingQueue(createdSlots),
                    admission = Semaphore(slotCount + slotCount, true),
                    affinityApplier = affinityApplier
                )
            } catch (e: Exception) {
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
    fun synthesize(text: String): ByteArray {
        retain()
        return try {
            synthesizeRetained(text)
        } finally {
            releaseRetain()
        }
    }

    internal fun retain(): TtsEnginePool {
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
    internal fun synthesizeRetained(text: String): ByteArray {
        if (!admission.tryAcquire()) {
            throw RejectedExecutionException(OVERLOAD_ERROR_MESSAGE)
        }
        var slot: Slot? = null
        return try {
            slot = idleSlots.take()
            slot.synthesize(text, affinityApplier)
        } finally {
            if (slot != null) {
                returnOrRelease(slot)
            }
            admission.release()
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
            // 已完成的 slot 必须先回到旧队列，避免 queued caller 永久等待。
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
        private val synthesizer: Synthesizer
    ) {
        private val released = AtomicBoolean(false)
        private val executor: ExecutorService = Executors.newSingleThreadExecutor { task ->
            Thread(task, "aasc-tts-slot-$id")
        }

        @Throws(Exception::class)
        fun synthesize(text: String, affinityApplier: (Long) -> Boolean): ByteArray {
            val future = executor.submit(Callable {
                // affinity 只影响调度位置；失败时继续使用 Android 默认调度，不能影响语音生成结果。
                affinityApplier(cpuMask)
                synthesizer.synthesize(text)
            })
            var interrupted = false
            try {
                while (true) {
                    try {
                        return future.get()
                    } catch (_: InterruptedException) {
                        // 外层 60 秒超时可能打断等待线程；继续等到 SDK 合成真实结束，
                        // 确保同一个 SpeechSynthesizer 不会被归还后并发复用。
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
                synthesizer.release()
            } finally {
                executor.shutdownNow()
            }
        }
    }

    private object MicrosoftSynthesizerFactory : SynthesizerFactory {
        override fun create(request: SynthesizerRequest): Synthesizer {
            val config = EmbeddedSpeechConfig.fromPath(request.modelDir.absolutePath)
            config.setSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm)
            config.setSpeechSynthesisVoice(request.voiceName, request.embeddedKey)
            // 生成端只拿 WAV 数据，必须显式传 null AudioConfig，禁止 SDK 连接默认扬声器。
            return MicrosoftSynthesizer(SpeechSynthesizer(config, null))
        }
    }

    private class MicrosoftSynthesizer(
        private val synthesizer: SpeechSynthesizer
    ) : Synthesizer {
        override fun synthesize(text: String): ByteArray {
            val result: SpeechSynthesisResult = synthesizer.SpeakText(text)
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

        override fun release() {
            synthesizer.close()
        }
    }
}
