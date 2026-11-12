package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WallpaperMotionLifecycleTest {
    @Test fun `只在壁纸可见且非前台时注册，切换和释放均注销`() {
        var starts = 0
        var stops = 0
        val lifecycle = WallpaperMotionLifecycle(start = { starts++; true }, stop = { stops++ })
        lifecycle.update(true, false, false)
        lifecycle.update(true, true, true)
        lifecycle.update(false, true, false)
        assertEquals(0, starts)
        lifecycle.update(true, true, false)
        lifecycle.update(true, true, false)
        assertTrue(lifecycle.listening)
        assertEquals(1, starts)
        lifecycle.update(true, true, true)
        assertFalse(lifecycle.listening)
        lifecycle.update(true, true, false)
        lifecycle.update(true, false, false)
        lifecycle.update(true, true, false)
        lifecycle.release()
        lifecycle.release()
        assertEquals(3, starts)
        assertEquals(3, stops)
    }

    @Test fun `注册失败不标记为监听并允许下次重试`() {
        var attempts = 0
        var stops = 0
        val lifecycle = WallpaperMotionLifecycle(start = { ++attempts > 1 }, stop = { stops++ })
        lifecycle.update(true, true, false)
        assertFalse(lifecycle.listening)
        lifecycle.update(true, true, false)
        assertTrue(lifecycle.listening)
        lifecycle.update(false, true, false)
        assertEquals(2, attempts)
        assertEquals(1, stops)
    }
}
