package com.aasc.display

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class AsrPcmTest {

    @Test
    fun decodeS16_标准样本转Float32() {
        // 两个 s16le 样本：32767 → 1.0（近似），-32768 → -1.0，0 → 0.0
        val bytes = byteArrayOf(
            0xFF.toByte(), 0x7F.toByte(),  // 32767
            0x00.toByte(), 0x80.toByte(),  // -32768
            0x00.toByte(), 0x00.toByte()   // 0
        )
        val out = AsrPcm.decodeS16(bytes)
        assertEquals(3, out.size)
        assertArrayEquals(
            floatArrayOf(0.9999695f, -1.0f, 0.0f),
            out,
            1e-5f
        )
    }

    @Test
    fun decodeS16_奇数长度忽略最后一个字节() {
        val bytes = byteArrayOf(0x00, 0x00, 0x01)  // 3 字节，只能解出 1 个样本
        val out = AsrPcm.decodeS16(bytes)
        assertEquals(1, out.size)
        assertEquals(0.0f, out[0], 1e-6f)
    }

    @Test
    fun decodeS16_空输入返回空数组() {
        assertEquals(0, AsrPcm.decodeS16(ByteArray(0)).size)
    }

    @Test
    fun encodeS16_与decodeS16往返一致() {
        val samples = floatArrayOf(0.5f, -0.5f, 0.0f, 1.0f, -1.0f)
        val bytes = AsrPcm.encodeS16(samples)
        val roundTrip = AsrPcm.decodeS16(bytes)
        assertArrayEquals(samples, roundTrip, 1e-3f)
    }

    @Test
    fun encodeS16_越界值被clamp到负1到1() {
        val bytes = AsrPcm.encodeS16(floatArrayOf(1.5f, -2.0f))
        val out = AsrPcm.decodeS16(bytes)
        assertEquals(1.0f, out[0], 1e-3f)
        assertEquals(-1.0f, out[1], 1e-3f)
    }
}
