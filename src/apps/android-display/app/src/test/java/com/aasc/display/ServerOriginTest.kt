package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerOriginTest {

    @Test
    fun fromUrl_提取显示页服务器origin() {
        assertEquals(
            "https://192.168.1.39:8081",
            ServerOrigin.fromUrl("https://192.168.1.39:8081/display?v=123")
        )
    }

    @Test
    fun fromUrl_空地址或非http地址返回空字符串() {
        assertEquals("", ServerOrigin.fromUrl(null))
        assertEquals("", ServerOrigin.fromUrl(""))
        assertEquals("", ServerOrigin.fromUrl("file:///android_asset/display.html"))
    }
}
