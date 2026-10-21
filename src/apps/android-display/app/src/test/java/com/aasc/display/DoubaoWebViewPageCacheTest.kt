package com.aasc.display

import org.junit.Assert.*
import org.junit.Test

class DoubaoWebViewPageCacheTest {
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
