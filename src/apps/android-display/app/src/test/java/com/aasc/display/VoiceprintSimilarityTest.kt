package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceprintSimilarityTest {
    @Test
    fun calculatesCosineSimilarityForEqualDirectionVectors() {
        assertEquals(1f, VoiceprintSimilarity.cosine(floatArrayOf(1f, 2f), floatArrayOf(2f, 4f)) ?: -1f, 0.00001f)
    }

    @Test
    fun rejectsEmptyMismatchedOrZeroVectors() {
        assertNull(VoiceprintSimilarity.cosine(floatArrayOf(), floatArrayOf()))
        assertNull(VoiceprintSimilarity.cosine(floatArrayOf(1f), floatArrayOf(1f, 2f)))
        assertNull(VoiceprintSimilarity.cosine(floatArrayOf(0f), floatArrayOf(1f)))
    }
}
