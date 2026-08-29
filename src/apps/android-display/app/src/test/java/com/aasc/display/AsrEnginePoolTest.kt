package com.aasc.display

import java.io.File
import java.util.Collections
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeoutException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Assert.assertTrue
import org.junit.Test

class AsrEnginePoolTest {

    @Test
    fun 并发上限等于大小核数量且超过后排队() {
        val recognizer = RecordingRecognizerFactory(operationDelayMs = 120)
        val policy = CpuTopology(
            listOf(
                0 to 1200000L,
                1 to 1200000L,
                2 to 2400000L
            )
        ).policy(bigCoreCount = 1, littleCoreCount = 1)
        val pool = AsrEnginePool.configure(
            policy = policy,
            modelFile = File("model.int8.onnx"),
            tokensFile = File("tokens.txt"),
            recognizerFactory = recognizer,
            affinityApplier = { true }
        )
        val startLine = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(3)

        try {
            val futures = (1..3).map { index ->
                executor.submit(Callable<String> {
                    assertTrue(startLine.await(2, TimeUnit.SECONDS))
                    pool.recognize(floatArrayOf(index.toFloat()))
                })
            }
            startLine.countDown()
            val results = futures.map { it.get(2, TimeUnit.SECONDS) }

            assertEquals(listOf("ok-1", "ok-2", "ok-3"), results.sorted())
            assertEquals(2, recognizer.maxConcurrentObserved.get())
        } finally {
            pool.retire()
            executor.shutdownNow()
        }
    }

    @Test
    fun affinity失败不会让识别请求失败且slot会归还() {
        val recognizer = RecordingRecognizerFactory(operationDelayMs = 1)
        val affinityMasks = Collections.synchronizedList(mutableListOf<Long>())
        val policy = CpuTopology(listOf(0 to 1200000L)).policy(bigCoreCount = 0, littleCoreCount = 1)
        val pool = AsrEnginePool.configure(
            policy = policy,
            modelFile = File("model.int8.onnx"),
            tokensFile = File("tokens.txt"),
            recognizerFactory = recognizer,
            affinityApplier = { mask ->
                affinityMasks.add(mask)
                false
            }
        )

        try {
            assertEquals("ok-1", pool.recognize(floatArrayOf(1f)))
            assertEquals("ok-2", pool.recognize(floatArrayOf(2f)))
            assertEquals(listOf(1L, 1L), affinityMasks.toList())
        } finally {
            pool.retire()
        }
    }

    @Test
    fun retire后旧池已排队请求仍会被旧slot服务() {
        val firstStarted = CountDownLatch(1)
        val releaseFirst = CountDownLatch(1)
        val recognizer = BlockingFirstRecognizerFactory(firstStarted, releaseFirst)
        val policy = CpuTopology(listOf(0 to 1200000L)).policy(bigCoreCount = 0, littleCoreCount = 1)
        val pool = AsrEnginePool.configure(
            policy = policy,
            modelFile = File("model.int8.onnx"),
            tokensFile = File("tokens.txt"),
            recognizerFactory = recognizer,
            affinityApplier = { true }
        )
        val executor = Executors.newFixedThreadPool(2)

        try {
            val first = executor.submit(Callable { pool.recognize(floatArrayOf(1f)) })
            assertTrue(firstStarted.await(2, TimeUnit.SECONDS))
            val second = executor.submit(Callable { pool.recognize(floatArrayOf(2f)) })

            pool.retire()
            Thread.sleep(50)
            assertFalse("第二个请求应先在旧池队列等待", second.isDone)
            releaseFirst.countDown()

            assertEquals("ok-1", first.get(2, TimeUnit.SECONDS))
            assertEquals("ok-2", second.get(2, TimeUnit.SECONDS))
            assertEquals(1, recognizer.releaseCount.get())
        } catch (e: TimeoutException) {
            releaseFirst.countDown()
            throw e
        } finally {
            pool.retire()
            executor.shutdownNow()
        }
    }

    @Test
    fun recognizer构造发生OOM时释放已经创建的slot() {
        val releaseCount = AtomicInteger(0)
        val factory = object : AsrEnginePool.RecognizerFactory {
            private val createCount = AtomicInteger(0)

            override fun create(modelFile: File, tokensFile: File, language: String): AsrEnginePool.Recognizer {
                if (createCount.incrementAndGet() == 2) throw OutOfMemoryError("test oom")
                return object : AsrEnginePool.Recognizer {
                    override fun recognize(samples: FloatArray): String = "ok"

                    override fun release() {
                        releaseCount.incrementAndGet()
                    }
                }
            }
        }
        val policy = CpuTopology(
            listOf(0 to 1200000L, 1 to 2400000L)
        ).policy(bigCoreCount = 1, littleCoreCount = 1)

        try {
            AsrEnginePool.configure(
                policy = policy,
                modelFile = File("model.int8.onnx"),
                tokensFile = File("tokens.txt"),
                recognizerFactory = factory,
                affinityApplier = { true }
            )
            fail("应向上层报告模型构造 OOM")
        } catch (error: OutOfMemoryError) {
            assertEquals(1, releaseCount.get())
        }
    }

    private class RecordingRecognizerFactory(
        private val operationDelayMs: Long
    ) : AsrEnginePool.RecognizerFactory {
        private val active = AtomicInteger(0)
        val maxConcurrentObserved = AtomicInteger(0)

        override fun create(modelFile: File, tokensFile: File, language: String): AsrEnginePool.Recognizer {
            return object : AsrEnginePool.Recognizer {
                override fun recognize(samples: FloatArray): String {
                    val nowActive = active.incrementAndGet()
                    maxConcurrentObserved.updateAndGet { previous -> maxOf(previous, nowActive) }
                    try {
                        Thread.sleep(operationDelayMs)
                        return "ok-${samples.first().toInt()}"
                    } finally {
                        active.decrementAndGet()
                    }
                }

                override fun release() = Unit
            }
        }
    }

    private class BlockingFirstRecognizerFactory(
        private val firstStarted: CountDownLatch,
        private val releaseFirst: CountDownLatch
    ) : AsrEnginePool.RecognizerFactory {
        private val calls = AtomicInteger(0)
        val releaseCount = AtomicInteger(0)

        override fun create(modelFile: File, tokensFile: File, language: String): AsrEnginePool.Recognizer {
            return object : AsrEnginePool.Recognizer {
                override fun recognize(samples: FloatArray): String {
                    val call = calls.incrementAndGet()
                    if (call == 1) {
                        firstStarted.countDown()
                        assertTrue(releaseFirst.await(2, TimeUnit.SECONDS))
                    }
                    return "ok-${samples.first().toInt()}"
                }

                override fun release() {
                    releaseCount.incrementAndGet()
                }
            }
        }
    }
}
