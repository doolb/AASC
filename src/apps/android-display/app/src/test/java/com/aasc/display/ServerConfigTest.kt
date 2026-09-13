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
    fun 离线模式没有地址时默认连接本机() {
        assertEquals(
            "https://127.0.0.1:8081",
            ServerConfig.chooseUrl(null, null, offlineMode = true)
        )
    }

    @Test
    fun 控制端页面使用同源control路径() {
        assertEquals(
            "https://127.0.0.1:8081/control",
            ServerConfig.controlPageUrl("https://127.0.0.1:8081")
        )
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

    @Test
    fun 子服务器配置使用主服务器根地址而不是display路径() {
        assertEquals(
            "https://192.168.1.39:8081",
            ServerConfig.baseUrl("https://192.168.1.39:8081/display")
        )
    }
}
