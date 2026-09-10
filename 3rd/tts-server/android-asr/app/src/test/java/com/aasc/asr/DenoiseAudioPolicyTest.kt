package com.aasc.asr

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
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

    @Test
    fun reusesOnePreparedAudioWhenBothPipelinesUseTheSameSetting() {
        val raw = floatArrayOf(1f, 2f)
        val cleaned = floatArrayOf(3f, 4f)
        var calls = 0

        val result = DenoiseAudioPolicy.preparePair(raw, true, true) {
            calls += 1
            cleaned
        }

        assertEquals(1, calls)
        assertSame(result.asr.samples, result.voiceprint.samples)
        assertArrayEquals(cleaned, result.asr.samples, 0f)
        assertArrayEquals(cleaned, result.voiceprint.samples, 0f)
    }

    @Test
    fun preparesIndependentAudioWhenPipelineSettingsDiffer() {
        val raw = floatArrayOf(1f, 2f)
        var calls = 0

        val result = DenoiseAudioPolicy.preparePair(raw, true, false) {
            calls += 1
            floatArrayOf(3f + calls, 4f + calls)
        }

        assertEquals(1, calls)
        assertArrayEquals(floatArrayOf(4f, 5f), result.asr.samples, 0f)
        assertArrayEquals(raw, result.voiceprint.samples, 0f)
    }
}
