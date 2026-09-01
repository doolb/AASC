package com.aasc.rapidocr

import org.junit.Assert.assertEquals
import org.junit.Test

class OcrTensorPreprocessorTest {
    @Test
    fun argbPixelsAreNormalizedInNchwOrder() {
        val pixels = intArrayOf(0xffff0000.toInt(), 0xff00ff00.toInt())

        val tensor = OcrTensorPreprocessor.toNchw(pixels, width = 2, height = 1)

        assertEquals(6, tensor.size)
        assertEquals(1f, tensor[0], 0.001f)
        assertEquals(-1f, tensor[1], 0.001f)
        assertEquals(-1f, tensor[2], 0.001f)
        assertEquals(1f, tensor[3], 0.001f)
        assertEquals(-1f, tensor[4], 0.001f)
        assertEquals(-1f, tensor[5], 0.001f)
    }
}
