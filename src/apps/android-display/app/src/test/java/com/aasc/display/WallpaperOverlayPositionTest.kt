package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WallpaperOverlayPositionTest {
    @Test fun `左右贴边收起恢复时保持边缘与相对高度`() {
        for (edge in listOf(-1, 1)) {
            val oldX = if (edge < 0) 0 else 1052
            val state = WallpaperOverlayPosition.capture(oldX, 1100, 1080, 2300, 28, 100, edge, true)
            assertTrue(state.collapsed)
            assertEquals(edge, state.edge)
            val position = state.resolve(2300, 1080, 60, 80)
            assertEquals(if (edge < 0) 0 else 2240, position.first)
            assertEquals(500, position.second)
        }
    }

    @Test fun `自由位置跨尺寸恢复并约束在屏幕范围内`() {
        val state = WallpaperOverlayPosition.capture(450, 900, 1000, 2000, 100, 200, 0, false)
        assertEquals(0.5f, state.xFraction, 0.0001f)
        assertEquals(0.5f, state.yFraction, 0.0001f)
        assertEquals(200 to 400, state.resolve(500, 1000, 100, 200))
        assertFalse(state.collapsed)
    }

    @Test fun `异常比例和超大浮窗不会越出屏幕`() {
        assertEquals(0 to 0, WallpaperOverlayPosition(Float.NaN, Float.POSITIVE_INFINITY, 0, false).resolve(100, 200, 200, 300))
        assertEquals(0 to 100, WallpaperOverlayPosition(-2f, 4f, 0, false).resolve(200, 200, 100, 100))
        val state = WallpaperOverlayPosition.capture(-200, 5000, 100, 200, 80, 100, 0, true)
        assertFalse(state.collapsed)
        assertEquals(0 to 100, state.resolve(100, 200, 80, 100))
    }

    @Test fun `展开状态和无贴边状态不会被恢复成收起`() {
        val expanded = WallpaperOverlayPosition.capture(900, 500, 1000, 2000, 100, 200, 1, false)
        assertFalse(expanded.collapsed)
        assertEquals(900, expanded.resolve(1000, 2000, 100, 200).first)
        val free = WallpaperOverlayPosition.capture(500, 500, 1000, 2000, 100, 200, 0, true)
        assertFalse(free.collapsed)
    }
}
