package com.aasc.display

import com.aasc.display.vision.ocr.OcrImageScale
import com.aasc.display.vision.ocr.OcrImageSize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OcrImageScaleTest {
    @Test
    fun shortSideUsesAnUpperBoundAndPreservesAspectRatio() {
        assertEquals(OcrImageSize(971, 512), OcrImageScale.targetSize(2048, 1080, 512))
        assertEquals(OcrImageSize(512, 971), OcrImageScale.targetSize(1080, 2048, 512))
        assertNull(OcrImageScale.targetSize(1000, 500, 736))
    }

    @Test
    fun shortSideAcceptsAutoAndSupportedRangeOnly() {
        assertEquals(0, OcrImageScale.normalizeShortSide(0))
        assertEquals(384, OcrImageScale.normalizeShortSide(384))
        assertEquals(2048, OcrImageScale.normalizeShortSide(2048))
        assertIllegalArgument { OcrImageScale.normalizeShortSide(255) }
        assertIllegalArgument { OcrImageScale.normalizeShortSide(2049) }
    }

    private fun assertIllegalArgument(action: () -> Unit) {
        try {
            action()
        } catch (_: IllegalArgumentException) {
            return
        }
        throw AssertionError("应抛出 IllegalArgumentException")
    }
}
