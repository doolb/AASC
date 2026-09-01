package com.aasc.rapidocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CtcDecoderTest {
    @Test
    fun repeatedTokensAndBlankAreCollapsed() {
        val logits = arrayOf(
            floatArrayOf(8f, 0f, 0f),
            floatArrayOf(0f, 8f, 0f),
            floatArrayOf(0f, 7f, 0f),
            floatArrayOf(8f, 0f, 0f),
            floatArrayOf(0f, 0f, 8f)
        )

        val decoded = CtcDecoder.decode(logits, listOf("A", "B"))

        assertEquals("AB", decoded.text)
        assertTrue(decoded.score > 0.9f)
    }

    @Test(expected = IllegalArgumentException::class)
    fun dictionaryBoundsProduceControlledError() {
        CtcDecoder.decode(arrayOf(floatArrayOf(0f, 1f, 8f)), listOf("A"))
    }
}
