package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Test

class AudioVolumeEnvelopeTest {
    @Test
    fun createsOnePointPerAudioWindow() {
        val samples = FloatArray(3200) { index -> if (index < 1600) 0.25f else -0.75f }

        val points = AudioVolumeEnvelope.fromSamples(samples, windowSamples = 1600)

        assertEquals(2, points.size)
        assertEquals(0.25f, points[0], 0.0001f)
        assertEquals(0.75f, points[1], 0.0001f)
    }

    @Test
    fun normalizesPcm16Peak() {
        val buffer = shortArrayOf(0, 16384, -32768, 10)

        assertEquals(1.0f, AudioVolumeEnvelope.fromPcm16(buffer, buffer.size), 0.0001f)
    }
}
