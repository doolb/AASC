package com.aasc.display

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WallpaperOverlayHitTestTest {
    @Test fun `左右半圆只接受可见范围`() {
        for (edge in listOf(-1, 1)) {
            val center = if (edge < 0) 0f else 16f
            val corner = if (edge < 0) 16f else 0f
            assertTrue(WallpaperOverlayHitTest.containsHalf(16, 32, center, 16f, edge))
            assertFalse(WallpaperOverlayHitTest.containsHalf(16, 32, corner, 0f, edge))
        }
        assertFalse(WallpaperOverlayHitTest.containsHalf(16, 32, 8f, 16f, 0))
    }
    @Test fun `只接受圆内和边缘的点击`() {
        assertTrue(WallpaperOverlayHitTest.contains(32, 32, 16f, 16f))
        assertTrue(WallpaperOverlayHitTest.contains(32, 32, 0f, 16f))
        assertFalse(WallpaperOverlayHitTest.contains(32, 32, 0f, 0f))
        assertFalse(WallpaperOverlayHitTest.contains(32, 32, -1f, 16f))
        assertFalse(WallpaperOverlayHitTest.contains(0, 0, 0f, 0f))
    }
}
