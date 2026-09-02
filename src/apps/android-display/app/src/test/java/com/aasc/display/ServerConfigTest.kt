package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerConfigTest {

    @Test
    fun intent地址优先于已保存地址() {
        assertEquals(
            "https://192.168.1.39:8081",
            ServerConfig.chooseUrl("https://192.168.1.39:8081", "https://old.example")
        )
    }

    @Test
    fun intent地址为空时沿用已保存地址() {
        assertEquals(
            "https://old.example",
            ServerConfig.chooseUrl("  ", "  https://old.example  ")
        )
    }

    @Test
    fun 两个地址都为空时返回空字符串() {
        assertEquals("", ServerConfig.chooseUrl(null, null))
    }

    @Test
    fun 普通服务器地址默认进入正式display页面() {
        assertEquals(
            "https://192.168.1.39:8081/display",
            ServerConfig.pageUrl("https://192.168.1.39:8081")
        )
    }

    @Test
    fun 正式display页面地址保持不变() {
        assertEquals(
            "https://192.168.1.39:8081/display",
            ServerConfig.pageUrl("https://192.168.1.39:8081/display")
        )
    }
}
