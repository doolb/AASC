package com.aasc.display

import java.io.File
import java.util.Collections
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class TtsEnginePoolTest {

    @Test
    fun 并发上限等于两个槽位且第三个请求排队返回Wav() {
        val factory = RecordingSynthesizerFactory(operationDelayMs = 120)
        val policy = CpuTopology(
            listOf(
                0 to 1200000L,
                1 to 1200000L,
                2 to 2400000L
            )
        ).policy(bigCoreCount = 1, littleCoreCount = 1)
        val pool = TtsEnginePool.configure(
            policy = policy,
            modelDir = File("models/tts"),
            voiceName = "Microsoft Xiaoxiao",
            embeddedKey = "test-key",
            synthesizerFactory = factory,
            affinityApplier = { true }
        )
        val startLine = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(3)

        try {
            val futures = (1..3).map { index ->
                executor.submit(Callable<ByteArray> {
                    assertTrue(startLine.await(2, TimeUnit.SECONDS))
                    pool.synthesize("文本$index")
                })
            }
            startLine.countDown()
            val results = futures.map { it.get(2, TimeUnit.SECONDS) }

            assertEquals(2, factory.maxConcurrentObserved.get())
            assertEquals(listOf(1, 2, 3), results.map { it.last().toInt() }.sorted())
            for (audio in results) {
                assertArrayEquals(byteArrayOf('R'.code.toByte(), 'I'.code.toByte(), 'F'.code.toByte(), 'F'.code.toByte()), audio.copyOfRange(0, 4))
            }
        } finally {
            pool.retire()
            executor.shutdownNow()
        }
    }

    @Test
    fun 每个槽位使用静音Wav构造且affinity失败不影响合成() {
        val factory = RecordingSynthesizerFactory(operationDelayMs = 1)
        val affinityMasks = Collections.synchronizedList(mutableListOf<Long>())
        val policy = CpuTopology(listOf(0 to 1200000L)).policy(bigCoreCount = 0, littleCoreCount = 1)
        val pool = TtsEnginePool.configure(
            policy = policy,
            modelDir = File("models/tts"),
            voiceName = "Microsoft Xiaoxiao",
            embeddedKey = "test-key",
            synthesizerFactory = factory,
            affinityApplier = { mask ->
                affinityMasks.add(mask)
                false
            }
        )

        try {
            val audio = pool.synthesize("你好")

            assertArrayEquals(byteArrayOf('R'.code.toByte(), 'I'.code.toByte(), 'F'.code.toByte(), 'F'.code.toByte()), audio.copyOfRange(0, 4))
            assertEquals(listOf(TtsEnginePool.AudioOutputMode.SILENT_WAV), factory.outputModes.toList())
            assertEquals(listOf(1L), affinityMasks.toList())
        } finally {
            pool.retire()
        }
    }

    @Test
    fun retire后旧池已排队请求仍会被旧slot服务() {
        val firstStarted = CountDownLatch(1)
        val releaseFirst = CountDownLatch(1)
        val factory = BlockingFirstSynthesizerFactory(firstStarted, releaseFirst)
        val policy = CpuTopology(listOf(0 to 1200000L)).policy(bigCoreCount = 0, littleCoreCount = 1)
        val pool = TtsEnginePool.configure(
            policy = policy,
            modelDir = File("models/tts"),
            voiceName = "Microsoft Xiaoxiao",
            embeddedKey = "test-key",
            synthesizerFactory = factory,
            affinityApplier = { true }
        )
        val executor = Executors.newFixedThreadPool(2)

        try {
            val firstRetain = pool.retain()
            val first = executor.submit(Callable { firstRetain.synthesizeRetained("第一句") })
            assertTrue(firstStarted.await(2, TimeUnit.SECONDS))
            val secondRetain = pool.retain()
            val second = executor.submit(Callable { secondRetain.synthesizeRetained("第二句") })

            pool.retire()
            Thread.sleep(50)
            assertFalse("第二个请求应先在旧池队列等待", second.isDone)
            releaseFirst.countDown()

            assertEquals(1, first.get(2, TimeUnit.SECONDS).last().toInt())
            firstRetain.releaseRetain()
            assertEquals(2, second.get(2, TimeUnit.SECONDS).last().toInt())
            secondRetain.releaseRetain()
            assertEquals(1, factory.releaseCount.get())
        } catch (e: TimeoutException) {
            releaseFirst.countDown()
            throw e
        } finally {
            pool.retire()
            executor.shutdownNow()
        }
    }

    @Test
    fun 超过显式准入上限时立即拒绝新请求() {
        val firstStarted = CountDownLatch(1)
        val releaseFirst = CountDownLatch(1)
        val factory = BlockingFirstSynthesizerFactory(firstStarted, releaseFirst)
        val policy = CpuTopology(listOf(0 to 1200000L)).policy(bigCoreCount = 0, littleCoreCount = 1)
        val pool = TtsEnginePool.configure(
            policy = policy,
            modelDir = File("models/tts"),
            voiceName = "Microsoft Xiaoxiao",
            embeddedKey = "test-key",
            synthesizerFactory = factory,
            affinityApplier = { true }
        )
        val executor = Executors.newFixedThreadPool(2)

        try {
            val first = executor.submit(Callable { pool.synthesize("第一句") })
            assertTrue(firstStarted.await(2, TimeUnit.SECONDS))
            val second = executor.submit(Callable { pool.synthesize("第二句") })

            Thread.sleep(50)
            assertFalse("第二个请求应在显式准入内排队等待", second.isDone)

            try {
                pool.synthesize("第三句")
                fail("第三个请求应因超过准入上限而被立即拒绝")
            } catch (e: RejectedExecutionException) {
                assertEquals("TTS 请求过多，请稍后重试", e.message)
            }

            releaseFirst.countDown()
            first.get(2, TimeUnit.SECONDS)
            second.get(2, TimeUnit.SECONDS)
        } catch (e: TimeoutException) {
            releaseFirst.countDown()
            throw e
        } finally {
            pool.retire()
            executor.shutdownNow()
        }
    }

    private class RecordingSynthesizerFactory(
        private val operationDelayMs: Long
    ) : TtsEnginePool.SynthesizerFactory {
        private val active = AtomicInteger(0)
        private val calls = AtomicInteger(0)
        val maxConcurrentObserved = AtomicInteger(0)
        val outputModes = Collections.synchronizedList(mutableListOf<TtsEnginePool.AudioOutputMode>())

        override fun create(request: TtsEnginePool.SynthesizerRequest): TtsEnginePool.Synthesizer {
            outputModes.add(request.outputMode)
            return object : TtsEnginePool.Synthesizer {
                override fun synthesize(text: String): ByteArray {
                    val nowActive = active.incrementAndGet()
                    maxConcurrentObserved.updateAndGet { previous -> maxOf(previous, nowActive) }
                    try {
                        Thread.sleep(operationDelayMs)
                        return wavWithCall(calls.incrementAndGet())
                    } finally {
                        active.decrementAndGet()
                    }
                }

                override fun release() = Unit
            }
        }
    }

    private class BlockingFirstSynthesizerFactory(
        private val firstStarted: CountDownLatch,
        private val releaseFirst: CountDownLatch
    ) : TtsEnginePool.SynthesizerFactory {
        private val calls = AtomicInteger(0)
        val releaseCount = AtomicInteger(0)

        override fun create(request: TtsEnginePool.SynthesizerRequest): TtsEnginePool.Synthesizer {
            return object : TtsEnginePool.Synthesizer {
                override fun synthesize(text: String): ByteArray {
                    val call = calls.incrementAndGet()
                    if (call == 1) {
                        firstStarted.countDown()
                        assertTrue(releaseFirst.await(2, TimeUnit.SECONDS))
                    }
                    return wavWithCall(call)
                }

                override fun release() {
                    releaseCount.incrementAndGet()
                }
            }
        }
    }

    private companion object {
        fun wavWithCall(call: Int): ByteArray {
            return byteArrayOf(
                'R'.code.toByte(),
                'I'.code.toByte(),
                'F'.code.toByte(),
                'F'.code.toByte(),
                call.toByte()
            )
        }
    }
}
