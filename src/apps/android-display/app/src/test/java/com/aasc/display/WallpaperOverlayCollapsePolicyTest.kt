package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WallpaperOverlayCollapsePolicyTest {
    @Test fun `零秒取消自动收起并限制异常值`() {
        assertNull(WallpaperOverlayCollapsePolicy.delayMillis(0))
        assertNull(WallpaperOverlayCollapsePolicy.delayMillis(-1))
        assertEquals(2000L, WallpaperOverlayCollapsePolicy.delayMillis(2))
        assertEquals(3600000L, WallpaperOverlayCollapsePolicy.delayMillis(9999))
    }
}
