package com.aasc.yolo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class YoloPostprocessorTest {
    private val transform = LetterboxTransform(
        sourceWidth = 640,
        sourceHeight = 640,
        scale = 1f,
        resizedWidth = 640,
        resizedHeight = 640,
        padLeft = 0f,
        padTop = 0f
    )

    @Test
    fun decodesFeatureFirstOutputAndMapsCenterBox() {
        val values = FloatArray(2 * 6)
        setCandidate(values, features = 6, candidate = 0, x = 320f, y = 240f, width = 100f, height = 60f, classId = 0, score = 0.9f)

        val detections = YoloPostprocessor.decode(longArrayOf(1, 6, 2), values, transform, 0.25f, 0.45f)

        assertEquals(1, detections.size)
        assertEquals(0, detections.single().classId)
        assertEquals(0.9f, detections.single().confidence, 0.001f)
        assertEquals(270f, detections.single().left, 0.001f)
        assertEquals(210f, detections.single().top, 0.001f)
    }

    @Test
    fun decodesCandidateFirstOutputAndSuppressesSameClassOverlap() {
        val values = FloatArray(2 * 6)
        setCandidate(values, features = 6, candidate = 0, x = 100f, y = 100f, width = 80f, height = 80f, classId = 0, score = 0.9f)
        setCandidate(values, features = 6, candidate = 1, x = 102f, y = 102f, width = 80f, height = 80f, classId = 0, score = 0.8f)

        val candidateFirst = FloatArray(2 * 6)
        for (candidate in 0..1) {
            for (feature in 0 until 6) {
                candidateFirst[candidate * 6 + feature] = values[feature * 2 + candidate]
            }
        }
        val detections = YoloPostprocessor.decode(longArrayOf(1, 2, 6), candidateFirst, transform, 0.25f, 0.45f)

        assertEquals(1, detections.size)
        assertTrue(detections.single().confidence > 0.85f)
    }

    @Test
    fun clampsNegativeClassScoresInsteadOfTreatingThemAsLogits() {
        val values = FloatArray(2 * 6)
        setCandidate(values, features = 6, candidate = 0, x = 320f, y = 240f, width = 100f, height = 60f, classId = 0, score = 0.1f)
        values[5 * 2] = -0.1f

        val detections = YoloPostprocessor.decode(longArrayOf(1, 6, 2), values, transform, 0.25f, 0.45f)

        assertEquals(0, detections.size)
    }

    private fun setCandidate(
        values: FloatArray,
        features: Int,
        candidate: Int,
        x: Float,
        y: Float,
        width: Float,
        height: Float,
        classId: Int,
        score: Float
    ) {
        val candidateCount = values.size / features
        values[0 * candidateCount + candidate] = x
        values[1 * candidateCount + candidate] = y
        values[2 * candidateCount + candidate] = width
        values[3 * candidateCount + candidate] = height
        values[4 * candidateCount + candidate] = if (classId == 0) score else 0f
        values[5 * candidateCount + candidate] = if (classId == 1) score else 0f
    }
}
