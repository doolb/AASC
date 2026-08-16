package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class ComputePixelsTest {

    // 2x2 RGBA8：glReadPixels 自底向上（buffer 里第一行是图像底部），验证行翻转 + R/G/B/A 通道顺序
    @Test
    fun rgba8_flipsRowsAndKeepsChannelOrder() {
        // 底行（y=1）两个红色像素，顶行（y=0）两个绿色像素；buffer 按自底向上排列
        val buf = ByteBuffer.allocateDirect(16).order(ByteOrder.nativeOrder())
        buf.put(byteArrayOf(
            0xFF.toByte(), 0, 0, 0xFF.toByte(),        // 底左 = 红
            0xFF.toByte(), 0, 0, 0xFF.toByte(),        // 底右 = 红
            0, 0xFF.toByte(), 0, 0xFF.toByte(),        // 顶左 = 绿
            0, 0xFF.toByte(), 0, 0xFF.toByte()         // 顶右 = 绿
        ))
        val out = ComputePixels.toArgb(buf, ImageFormat.RGBA8, 2, 2)
        // 输出自顶向下：out[0]=顶左(绿) out[1]=顶右(绿) out[2]=底左(红) out[3]=底右(红)
        assertEquals(0xFF00FF00.toInt(), out[0])
        assertEquals(0xFF00FF00.toInt(), out[1])
        assertEquals(0xFFFF0000.toInt(), out[2])
        assertEquals(0xFFFF0000.toInt(), out[3])
    }

    // 1x2 RGBA32F：浮点缩放（1.0→255）+ 行翻转
    @Test
    fun rgba32f_scalesAndFlips() {
        val buf = ByteBuffer.allocateDirect(8 * 4).order(ByteOrder.nativeOrder())
        // 底（y=1）= 红 (1,0,0,1)；顶（y=0）= 绿 (0,1,0,1)
        buf.asFloatBuffer().put(floatArrayOf(1f, 0f, 0f, 1f, 0f, 1f, 0f, 1f))
        val out = ComputePixels.toArgb(buf, ImageFormat.RGBA32F, 1, 2)
        assertEquals(0xFF00FF00.toInt(), out[0])  // 顶 = 绿
        assertEquals(0xFFFF0000.toInt(), out[1])  // 底 = 红
    }

    // RGBA32F 越界钳制：>1 钳到 255，<0 钳到 0
    @Test
    fun rgba32f_clampsOutOfRange() {
        val buf = ByteBuffer.allocateDirect(4 * 4).order(ByteOrder.nativeOrder())
        buf.asFloatBuffer().put(floatArrayOf(2f, -1f, 0.5f, 1f))
        val out = ComputePixels.toArgb(buf, ImageFormat.RGBA32F, 1, 1)
        val r = (out[0] shr 16) and 0xFF
        val g = (out[0] shr 8) and 0xFF
        val b = out[0] and 0xFF
        val a = (out[0] shr 24) and 0xFF
        assertEquals(255, r)   // 2.0 → 255
        assertEquals(0, g)     // -1.0 → 0
        assertEquals(127, b)   // 0.5*255=127.5 → 127
        assertEquals(255, a)   // 1.0 → 255
    }

    // R32F 单通道复制到 RGB + A=255
    @Test
    fun r32f_replicatesSingleChannel() {
        val buf = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder())
        buf.asFloatBuffer().put(floatArrayOf(1f))
        val out = ComputePixels.toArgb(buf, ImageFormat.R32F, 1, 1)
        assertEquals(0xFFFFFFFF.toInt(), out[0])
    }

    // RGBA32UI uint 截断低 8 位
    @Test
    fun rgba32ui_truncatesLow8Bits() {
        val buf = ByteBuffer.allocateDirect(4 * 4).order(ByteOrder.nativeOrder())
        buf.asIntBuffer().put(intArrayOf(0x000000FF, 0x0000FF00, 0x00FF0000, 0xFF000000.toInt()))
        val out = ComputePixels.toArgb(buf, ImageFormat.RGBA32UI, 1, 1)
        val r = (out[0] shr 16) and 0xFF
        val g = (out[0] shr 8) and 0xFF
        val b = out[0] and 0xFF
        val a = (out[0] shr 24) and 0xFF
        assertEquals(0xFF, r)
        assertEquals(0x00, g)
        assertEquals(0x00, b)
        assertEquals(0x00, a)
    }
}
