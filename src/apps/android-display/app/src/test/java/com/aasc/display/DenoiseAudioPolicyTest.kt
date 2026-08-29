package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class DenoiseAudioPolicyTest {
    @Test
    fun 关闭降噪不调用处理器() {
        var calls = 0
        val raw = floatArrayOf(1f)
        val result = DenoiseAudioPolicy.prepare(raw, false) {
            calls += 1
            floatArrayOf(2f)
        }
        assertEquals(0, calls)
        assertSame(raw, result.samples)
        assertEquals(false, result.enabled)
    }

    @Test
    fun 开启降噪只调用一次处理器并记录耗时() {
        var calls = 0
        val result = DenoiseAudioPolicy.prepare(floatArrayOf(1f), true) {
            calls += 1
            floatArrayOf(2f)
        }
        assertEquals(1, calls)
        assertEquals(floatArrayOf(2f).toList(), result.samples.toList())
        assertEquals(true, result.enabled)
    }
}
