package com.aasc.display

import org.junit.Assert.*
import org.junit.Test

class DoubaoWebViewPageCacheTest {
    @Test fun `查看关闭再打开仍复用同一页面且销毁前先卸载`() {
        val events = mutableListOf<String>()
        val cache = DoubaoWebViewPageCache<Any> { events.add("destroy") }
        val owner = Any()
        cache.observe(owner) { events.add(if (it == null) "empty" else "page") }
        val page = cache.getOrCreate { Any() }
        cache.stopObserving(owner)
        assertSame(page, cache.current)
        assertEquals(listOf("empty", "page", "empty"), events)
        cache.observe(owner) { events.add(if (it == null) "empty" else "page") }
        assertSame(page, cache.getOrCreate { error("查看不能重建页面") })
        assertTrue(cache.clear())
        assertEquals(listOf("empty", "page", "empty", "page", "empty", "destroy"), events)
        val next = cache.getOrCreate { Any() }
        assertNotSame(page, next)
        assertEquals("page", events.last())
    }

    @Test fun `旧查看者退出不影响新窗口且过期销毁不通知新页`() {
        val cache = DoubaoWebViewPageCache<Any> { }
        val old = Any()
        val owner = Any()
        val oldFrames = mutableListOf<Any?>()
        val frames = mutableListOf<Any?>()
        val page = cache.getOrCreate { Any() }
        cache.observe(old) { oldFrames.add(it) }
        cache.observe(owner) { frames.add(it) }
        cache.stopObserving(old)
        assertEquals(listOf(page, null), oldFrames)
        assertEquals(listOf(page), frames)
        cache.clear(page)
        val next = cache.getOrCreate { Any() }
        assertFalse(cache.clear(page))
        assertEquals(listOf(page, null, next), frames)
        cache.stopObserving(owner)
        assertSame(next, cache.current)
    }

    @Test fun `查看异常不影响页面创建销毁或后台重建`() {
        val destroyed = mutableListOf<Any>()
        val cache = DoubaoWebViewPageCache<Any> { destroyed.add(it) }
        cache.observe(Any()) { error("模拟已关闭的查看窗口") }
        val page = cache.getOrCreate { Any() }
        assertSame(page, cache.current)
        assertTrue(cache.clear(page))
        assertEquals(listOf(page), destroyed)
        assertNotNull(cache.getOrCreate { Any() })
    }

    @Test fun `成功关闭后按需重建且关闭幂等`() {
        val destroyed = mutableListOf<Any>()
        val cache = DoubaoWebViewPageCache<Any> { destroyed.add(it) }
        val first = cache.getOrCreate { Any() }
        assertSame(first, cache.getOrCreate { error("已有页面不重建") })
        assertTrue(cache.clear(first))
        assertNull(cache.current)
        assertFalse(cache.clear(first))
        val next = cache.getOrCreate { Any() }
        assertNotSame(first, next)
        assertEquals(listOf(first), destroyed)
        // 旧请求的迟到清理不能影响新页面。
        assertFalse(cache.clear(first))
        assertSame(next, cache.current)
        assertTrue(cache.clear())
        assertEquals(listOf(first, next), destroyed)
    }
}
