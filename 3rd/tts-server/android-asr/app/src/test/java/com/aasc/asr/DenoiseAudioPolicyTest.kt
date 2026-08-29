package com.aasc.asr

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class DenoiseAudioPolicyTest {
    @Test
    fun disabledKeepsRawSamplesWithoutCallingProcessor() {
        val raw = floatArrayOf(1f, 2f)
        var calls = 0

        val result = DenoiseAudioPolicy.prepare(raw, false) {
            calls += 1
            floatArrayOf(3f, 4f)
        }

        assertArrayEquals(raw, result.samples, 0f)
        assertEquals(0, calls)
        assertEquals(0L, result.elapsedMs)
    }

    @Test
    fun enabledUsesProcessorOutputAndMeasuresItOnce() {
        val raw = floatArrayOf(1f, 2f)
        val cleaned = floatArrayOf(3f, 4f)
        var calls = 0

        val result = DenoiseAudioPolicy.prepare(raw, true) {
            calls += 1
            cleaned
        }

        assertArrayEquals(cleaned, result.samples, 0f)
        assertEquals(1, calls)
        assertEquals(true, result.enabled)
    }
}
