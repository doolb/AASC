package com.aasc.display

import com.aasc.display.vision.VisionImageCodec
import org.junit.Assert.assertEquals
import org.junit.Test

class VisionImageCodecTest {
    @Test
    fun formalVisionImageLimitsMatchTheDocumentedContract() {
        assertEquals(20 * 1024 * 1024, VisionImageCodec.MAX_BODY_BYTES)
        assertEquals(12 * 1024 * 1024, VisionImageCodec.MAX_PIXELS)
    }
}
