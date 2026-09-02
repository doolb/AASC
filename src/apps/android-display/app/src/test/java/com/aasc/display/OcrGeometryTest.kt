package com.aasc.display

import com.aasc.display.vision.ocr.OcrGeometry
import com.aasc.display.vision.ocr.OcrPoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OcrGeometryTest {
    @Test
    fun shuffledQuadrilateralIsOrderedClockwiseFromTopLeft() {
        val points = listOf(OcrPoint(100f, 100f), OcrPoint(0f, 0f), OcrPoint(0f, 100f), OcrPoint(100f, 0f))
        val ordered = OcrGeometry.orderClockwise(points)
        assertEquals(listOf(OcrPoint(0f, 0f), OcrPoint(100f, 0f), OcrPoint(100f, 100f), OcrPoint(0f, 100f)), ordered)
    }

    @Test
    fun detectorCoordinatesAreMappedBackToOriginalImage() {
        val mapped = OcrGeometry.scaleToOriginal(listOf(OcrPoint(20f, 15f)), 0.5f, 0.25f, 10f, 20f)
        assertEquals(50f, mapped.single().x, 0.001f)
        assertEquals(80f, mapped.single().y, 0.001f)
        assertTrue(mapped.single().x >= 0f)
    }
}
