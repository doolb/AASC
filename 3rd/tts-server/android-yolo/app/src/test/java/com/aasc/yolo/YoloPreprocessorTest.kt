package com.aasc.yolo

import org.junit.Assert.assertEquals
import org.junit.Test

class YoloPreprocessorTest {
    @Test
    fun landscapeImageGetsVerticalLetterboxPadding() {
        val transform = YoloPreprocessor.calculateTransform(1280, 720)

        assertEquals(0.5f, transform.scale, 0.0001f)
        assertEquals(640, transform.resizedWidth)
        assertEquals(360, transform.resizedHeight)
        assertEquals(0f, transform.padLeft, 0.0001f)
        assertEquals(140f, transform.padTop, 0.0001f)
    }

    @Test
    fun nchwInputUsesRgbAndZeroToOneNormalization() {
        val pixels = intArrayOf(0xffff0000.toInt(), 0xff00ff00.toInt())

        val tensor = YoloPreprocessor.toNchw(pixels, width = 2, height = 1)

        assertEquals(6, tensor.size)
        assertEquals(1f, tensor[0], 0.001f)
        assertEquals(0f, tensor[1], 0.001f)
        assertEquals(0f, tensor[2], 0.001f)
        assertEquals(1f, tensor[3], 0.001f)
        assertEquals(0f, tensor[4], 0.001f)
        assertEquals(0f, tensor[5], 0.001f)
    }
}
