package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceprintSimilarityTest {
    @Test
    fun calculatesCosineSimilarity() {
        val score = VoiceprintSimilarity.cosine(
            floatArrayOf(1f, 0f),
            floatArrayOf(0.8f, 0.6f)
        )

        assertEquals(0.8f, score!!, 0.00001f)
    }

    @Test
    fun returnsNullWhenVectorCannotProduceSimilarity() {
        assertNull(VoiceprintSimilarity.cosine(floatArrayOf(), floatArrayOf()))
        assertNull(VoiceprintSimilarity.cosine(floatArrayOf(1f), floatArrayOf(1f, 0f)))
        assertNull(VoiceprintSimilarity.cosine(floatArrayOf(0f), floatArrayOf(1f)))
    }
}
