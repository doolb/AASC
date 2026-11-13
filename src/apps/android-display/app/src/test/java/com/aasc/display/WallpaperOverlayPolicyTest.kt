package com.aasc.display

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WallpaperOverlayPolicyTest {
    private fun allow(hide: Boolean = true, visible: Boolean = true, wasVisible: Boolean = true,
                      desktop: Boolean? = true, preview: Boolean = false, foreground: Boolean = false,
                      suspended: Boolean = false, attached: Boolean = true) =
        WallpaperOverlayPolicy.canShow(hide, visible, wasVisible, desktop, preview, foreground, suspended, attached)

    @Test fun `默认仅在桌面可见时显示并兼容未知桌面`() {
        assertTrue(allow())
        assertTrue(allow(desktop = null))
        assertFalse(allow(desktop = false))
        assertFalse(allow(visible = false))
    }

    @Test fun `允许其他应用时真实壁纸被遮挡仍保留`() {
        assertTrue(allow(hide = false, visible = false, desktop = false))
        assertFalse(allow(hide = false, visible = false, desktop = false, wasVisible = false))
    }

    @Test fun `允许其他应用也不覆盖前台预览暂停和页面释放`() {
        assertFalse(allow(hide = false, preview = true))
        assertFalse(allow(hide = false, foreground = true))
        assertFalse(allow(hide = false, suspended = true))
        assertFalse(allow(hide = false, attached = false))
    }
}
