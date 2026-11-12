package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserMediaUserAgentTest {
    @Test fun 抖音使用桌面标识并保留系统浏览器版本() {
        val agent = "Mozilla/5.0 (Linux; Android 9; Device; wv) AppleWebKit/537.36 Version/4.0 Chrome/120.0.1.0 Mobile Safari/537.36"
        val result = BrowserMediaUserAgent.forOrigin("https://www.douyin.com", agent)
        assertTrue(result.contains("X11; Linux x86_64"))
        assertTrue(result.contains("Chrome/120.0.1.0 Safari/537.36"))
        assertFalse(result.contains("Android"))
        assertEquals(agent, BrowserMediaUserAgent.forOrigin("https://example.com", agent))
    }
}
