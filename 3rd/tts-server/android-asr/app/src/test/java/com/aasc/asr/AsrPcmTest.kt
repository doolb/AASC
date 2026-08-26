package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Test

class AsrPcmTest {
    @Test
    fun decodeS16UsesLittleEndianAndNormalizesSamples() {
        val samples = AsrPcm.decodeS16(byteArrayOf(0, 0, 0, 64, 0, -128))
        assertEquals(0.0f, samples[0], 0.0001f)
        assertEquals(0.5f, samples[1], 0.0001f)
        assertEquals(-1.0f, samples[2], 0.0001f)
    }
}
