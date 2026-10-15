package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class Chat2ApiWebViewDataDirectoryInitializerTest {
    @Test
    fun initialize_AndroidP及以上同一进程只设置一次后缀() {
        val initializer = Chat2ApiWebViewDataDirectoryInitializer()
        val suffixes = mutableListOf<String>()

        initializer.initialize(28, suffixes::add)
        initializer.initialize(35, suffixes::add)

        assertEquals(listOf("aasc_chat2api_login"), suffixes)
    }

    @Test
    fun initialize_AndroidP以下不调用平台设置器() {
        val initializer = Chat2ApiWebViewDataDirectoryInitializer()

        initializer.initialize(27) { fail("Android P 以下不应设置 WebView 数据目录后缀") }
    }

    @Test
    fun initialize_设置失败后允许再次尝试() {
        val initializer = Chat2ApiWebViewDataDirectoryInitializer()
        var calls = 0

        try {
            initializer.initialize(28) {
                calls += 1
                throw IllegalStateException("设置失败")
            }
            fail("设置器异常应向调用方传播")
        } catch (_: IllegalStateException) {
            // 设置失败必须保留未初始化状态。
        }

        initializer.initialize(28) { calls += 1 }

        assertEquals(2, calls)
    }
}
