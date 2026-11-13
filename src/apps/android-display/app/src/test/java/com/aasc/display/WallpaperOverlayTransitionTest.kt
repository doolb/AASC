package com.aasc.display

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WallpaperOverlayTransitionTest {
    @Test fun `重复隐藏只允许一个移除回调`() {
        val transition = WallpaperOverlayTransition()
        val first = requireNotNull(transition.beginHide())
        assertNull(transition.beginHide())
        assertTrue(transition.mayRemove(first))
    }

    @Test fun `重新显示或新一次隐藏使旧渐隐回调失效`() {
        val transition = WallpaperOverlayTransition()
        val first = requireNotNull(transition.beginHide())
        transition.show()
        assertFalse(transition.mayRemove(first))
        val second = requireNotNull(transition.beginHide())
        assertFalse(transition.mayRemove(first))
        assertTrue(transition.mayRemove(second))
        transition.show()
        assertFalse(transition.mayRemove(second))
    }
}
