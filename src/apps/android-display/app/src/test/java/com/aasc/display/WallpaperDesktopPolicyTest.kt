package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WallpaperDesktopPolicyTest {
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
