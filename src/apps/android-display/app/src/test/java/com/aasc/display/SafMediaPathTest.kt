package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SafMediaPathTest {

    @Test
    fun 虚拟根路径和普通子路径统一为斜杠格式() {
        assertEquals("/", SafMediaPath.normalize(""))
        assertEquals("/", SafMediaPath.normalize("/"))
        assertEquals("/movies/demo.mp4", SafMediaPath.normalize("movies/demo.mp4"))
        assertEquals("/movies/demo.mp4", SafMediaPath.normalize("/movies/demo.mp4/"))
    }

    @Test
    fun 路径遍历反斜杠和空分段都会被拒绝() {
        listOf(
            "/../secret.txt",
            "/movies/../secret.txt",
            "/movies\\secret.txt",
            "/movies//secret.txt",
            "/movies/./secret.txt"
        ).forEach { value ->
            assertThrows(IllegalArgumentException::class.java) {
                SafMediaPath.normalize(value)
            }
        }
    }

    @Test
    fun Range支持起止开放和后缀范围() {
        assertEquals(SafMediaRange(10, 19), SafMediaPath.parseRange("bytes=10-19", 100))
        assertEquals(SafMediaRange(10, 99), SafMediaPath.parseRange("bytes=10-", 100))
        assertEquals(SafMediaRange(90, 99), SafMediaPath.parseRange("bytes=-10", 100))
        assertEquals(null, SafMediaPath.parseRange("bytes=100-", 100))
    }
}
