package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WallpaperDesktopPolicyTest {
    @Test fun `only state changes and active or focused window changes affect desktop`() {
        assertTrue(WallpaperDesktopPolicy.acceptsWindowEvent(true, false, 0, 1, 2))
        assertTrue(WallpaperDesktopPolicy.acceptsWindowEvent(false, true, 1, 1, 2))
        assertTrue(WallpaperDesktopPolicy.acceptsWindowEvent(false, true, 2, 1, 2))
        assertFalse(WallpaperDesktopPolicy.acceptsWindowEvent(false, true, 4, 1, 2))
        assertFalse(WallpaperDesktopPolicy.acceptsWindowEvent(false, false, 3, 1, 2))
    }
    @Test fun `desktop and foreground apps are distinguished while system overlays are ignored`() {
        val homes = setOf("phone.launcher")
        assertEquals(true, WallpaperDesktopPolicy.classify("phone.launcher", "Launcher", "com.aasc.display", homes))
        assertEquals(false, WallpaperDesktopPolicy.classify("phone.browser", "BrowserActivity", "com.aasc.display", homes))
        assertEquals(false, WallpaperDesktopPolicy.classify("com.aasc.display", "LoginActivity", "com.aasc.display", homes))
        assertNull(WallpaperDesktopPolicy.classify("com.android.systemui", "Shade", "com.aasc.display", homes))
        assertNull(WallpaperDesktopPolicy.classify("com.aasc.display", "android.app.Presentation", "com.aasc.display", homes))
        assertNull(WallpaperDesktopPolicy.classify("phone.browser", "Browser", "com.aasc.display", emptySet()))
    }
}
