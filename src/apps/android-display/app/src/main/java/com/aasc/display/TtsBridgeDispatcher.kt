package com.aasc.display

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Callable
import java.util.concurrent.Future
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * TTS 原生桥的有界任务调度器。
 *
 * 桥入口在提交时就完成有限准入，避免把大量请求先转换成阻塞 TTS pool 的无限线程。
 * 换代时只关闭旧执行器的新增提交入口，保留其活动任务和队列任务排空，不中断已有合成。
 */
class TtsBridgeDispatcher(workerCount: Int) {

    companion object {
        const val OVERLOAD_ERROR_MESSAGE = "TTS 请求过多，请稍后重试"
        private const val SHUTDOWN_ERROR_MESSAGE = "TTS 桥已关闭"

        private fun normalizedWorkerCount(workerCount: Int): Int = maxOf(1, workerCount)
    }

    private val lock = Any()
    private var executor = createExecutor(normalizedWorkerCount(workerCount))
    private var shutdown = false

    fun <T> submit(task: Callable<T>): Future<T> {
        synchronized(lock) {
            ensureRunning()
            return try {
                executor.submit(task)
            } catch (e: RejectedExecutionException) {
                throw RejectedExecutionException(OVERLOAD_ERROR_MESSAGE, e)
            }
        }
    }

    /**
     * 用新 policy 的 slot 数替换执行器；旧执行器使用 shutdown() 排空，不调用 shutdownNow()。
     */
    fun reconfigure(workerCount: Int) {
        synchronized(lock) {
            ensureRunning()
            val replacement = createExecutor(normalizedWorkerCount(workerCount))
            val retired = executor
            executor = replacement
            retired.shutdown()
        }
    }

    fun shutdown() {
        synchronized(lock) {
            if (shutdown) return
            shutdown = true
            executor.shutdown()
        }
    }

    private fun ensureRunning() {
        if (shutdown) {
            throw RejectedExecutionException(SHUTDOWN_ERROR_MESSAGE)
        }
    }

    private fun createExecutor(workerCount: Int): ThreadPoolExecutor {
        val queueCapacity = workerCount
        return ThreadPoolExecutor(
            workerCount,
            workerCount,
            0L,
            TimeUnit.MILLISECONDS,
            ArrayBlockingQueue(queueCapacity),
            { task -> Thread(task, "aasc-tts-bridge") },
            ThreadPoolExecutor.AbortPolicy()
        )
    }
}
