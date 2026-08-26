package com.aasc.display

import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class TtsBridgeDispatcherTest {

    @Test
    fun 工作线程和队列按slotCount限制并在提交时拒绝溢出() {
        val dispatcher = TtsBridgeDispatcher(2)
        val started = CountDownLatch(2)
        val release = CountDownLatch(1)

        try {
            val active = (1..2).map {
                dispatcher.submit(Callable {
                    started.countDown()
                    assertTrue(release.await(2, TimeUnit.SECONDS))
                    it
                })
            }
            assertTrue(started.await(2, TimeUnit.SECONDS))

            val queued = (3..4).map {
                dispatcher.submit(Callable { it })
            }
            assertFalse(queued[0].isDone)
            assertFalse(queued[1].isDone)

            try {
                dispatcher.submit(Callable { 5 })
                fail("超过 workerCount + queueCapacity 后应在提交时拒绝")
            } catch (e: RejectedExecutionException) {
                assertEquals(TtsBridgeDispatcher.OVERLOAD_ERROR_MESSAGE, e.message)
            }

            release.countDown()
            assertEquals(listOf(1, 2), active.map { it.get(2, TimeUnit.SECONDS) })
            assertEquals(listOf(3, 4), queued.map { it.get(2, TimeUnit.SECONDS) })
        } finally {
            release.countDown()
            dispatcher.shutdown()
        }
    }

    @Test
    fun 换代后旧执行器排空已提交任务且不打断活动任务() {
        val dispatcher = TtsBridgeDispatcher(1)
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)

        try {
            val active = dispatcher.submit(Callable {
                started.countDown()
                assertTrue(release.await(2, TimeUnit.SECONDS))
                "active"
            })
            assertTrue(started.await(2, TimeUnit.SECONDS))
            val queued = dispatcher.submit(Callable { "queued" })

            dispatcher.reconfigure(2)
            release.countDown()

            assertEquals("active", active.get(2, TimeUnit.SECONDS))
            assertEquals("queued", queued.get(2, TimeUnit.SECONDS))
            assertEquals("new", dispatcher.submit(Callable { "new" }).get(2, TimeUnit.SECONDS))
        } finally {
            release.countDown()
            dispatcher.shutdown()
        }
    }
}
