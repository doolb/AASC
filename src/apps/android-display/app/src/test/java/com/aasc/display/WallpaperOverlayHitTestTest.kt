package com.aasc.display

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WallpaperOverlayHitTestTest {
    @Test fun `只接受圆内和边缘的点击`() {
        assertTrue(WallpaperOverlayHitTest.contains(32, 32, 16f, 16f))
        assertTrue(WallpaperOverlayHitTest.contains(32, 32, 0f, 16f))
        assertFalse(WallpaperOverlayHitTest.contains(32, 32, 0f, 0f))
        assertFalse(WallpaperOverlayHitTest.contains(32, 32, -1f, 16f))
        assertFalse(WallpaperOverlayHitTest.contains(0, 0, 0f, 0f))
    }
}
